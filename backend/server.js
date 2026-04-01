require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const multer = require("multer");
const { GridFSBucket } = require('mongodb');
const mime = require("mime-types");
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/database');
const Media = require('./models/Media');

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_ENABLED = process.env.AUTH_ENABLED !== "false";
const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "change-me";
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || "3h";

// Parse allowed origins safely with fallback for local dev
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);

// CORS config: dynamic origin validation with proper error handling
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin or mobile apps)
    if (!origin) return callback(null, true);
    
    // Allow localhost for local development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    
    // Allow configured origins (for production: Vercel domain)
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Reject unknown origins
    const err = new Error(`CORS policy: origin ${origin} not allowed`);
    console.warn(err.message);
    callback(err);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Total-Count', 'Content-Disposition'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Optionally serve frontend from backend (for local all-in-one or integrated deployment)
const SERVE_FRONTEND = process.env.SERVE_FRONTEND !== 'false';
if (SERVE_FRONTEND) {
  app.use(express.static(path.join(__dirname, 'frontend')));
}

// File upload storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Auth system: JWT token-based, with optional fallback to basic for compatibility
const AUTH_ENABLED_VAR = process.env.AUTH_ENABLED !== "false";

function respondUnauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

function jwtMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();

  if (req.path.startsWith('/api/auth')) return next();

  if (req.method === 'OPTIONS') return next();

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return respondUnauthorized(res);
  }

  const token = authHeader.slice(7).trim();
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return respondUnauthorized(res);
    req.auth = payload;
    next();
  });
}

app.use(jwtMiddleware);

function detectType(fileName) {
  const contentType = mime.lookup(fileName) || "application/octet-stream";
  if (contentType.startsWith("video/")) return { type: "video", contentType };
  if (contentType.startsWith("audio/")) return { type: "audio", contentType };
  if (contentType.startsWith("image/")) return { type: "image", contentType };

  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"].includes(ext)) return { type: "video", contentType };
  if ([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"].includes(ext)) return { type: "audio", contentType };
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) return { type: "image", contentType };
  return { type: "other", contentType };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.status(200).json({ 
      ok: true, 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('💥 Health check failed:', error);
    res.status(503).json({ 
      ok: false, 
      database: 'disconnected', 
      error: error.message 
    });
  }
});

// Auth login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
      console.warn(`⚠️ Failed login attempt for username: ${username}`);
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = jwt.sign(
      { username, iat: Math.floor(Date.now() / 1000) }, 
      JWT_SECRET, 
      { expiresIn: TOKEN_EXPIRY }
    );
    
    console.log(`✅ Successful login for user: ${username}`);
    
    return res.status(200).json({ token, expiresIn: TOKEN_EXPIRY });
  } catch (error) {
    console.error('💥 Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed', details: error.message });
  }
});

// Upload endpoint
app.post("/api/upload", upload.single("media"), async (req, res) => {
  try {
    // Validate file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Validate file size (limit to 500MB)
    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(413).json({ error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` });
    }

    // Detect media type
    const { type, contentType } = detectType(req.file.originalname);

    // Create GridFS bucket
    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const filename = `${Date.now()}-${req.file.originalname.replace(/[^\w.\-() ]/g, "_").trim()}`;

    // Create upload stream with proper error handling
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: contentType || req.file.mimetype,
      metadata: { 
        type,
        uploadedAt: new Date()
      }
    });

    // Handle stream errors
    uploadStream.on('error', (error) => {
      console.error('💥 GridFS upload stream error:', error);
      // Only send response if not already sent
      if (!res.headersSent) {
        return res.status(500).json({ error: "Upload stream failed", details: error.message });
      }
    });

    // Handle successful upload
    uploadStream.on('finish', async () => {
      try {
        // GridFS upload completed - now save metadata to MongoDB
        const gridFsId = uploadStream.id; // Get the ObjectId of uploaded file

        if (!gridFsId) {
          console.error('💥 gridFsId is undefined after upload');
          if (!res.headersSent) {
            return res.status(500).json({ error: "Upload completed but file ID is missing" });
          }
          return;
        }

        // Save media metadata to database
        const media = new Media({
          filename: filename,
          originalName: req.file.originalname,
          contentType: contentType || req.file.mimetype,
          size: req.file.size,
          metadata: { type },
          gridFsId: gridFsId
        });

        await media.save();

        console.log(`✅ File uploaded successfully: ${media._id} (${filename})`);

        return res.status(201).json({
          message: "Upload successful.",
          item: {
            id: media._id.toString(),
            name: media.originalName,
            size: humanSize(media.size),
            type: media.metadata.type,
            contentType: media.contentType,
            url: `/api/media/${media._id}/stream`,
            uploadDate: media.uploadDate.toISOString()
          }
        });
      } catch (dbError) {
        console.error('💥 Database error after upload:', dbError);
        // File was uploaded to GridFS but DB error occurred
        // Try to clean up the GridFS file
        try {
          const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
          if (uploadStream.id) {
            await bucket.delete(uploadStream.id);
            console.log('Cleaned up orphaned GridFS file');
          }
        } catch (cleanupError) {
          console.error('Failed to cleanup orphaned file:', cleanupError);
        }
        if (!res.headersSent) {
          return res.status(500).json({ error: "Upload failed during database save", details: dbError.message });
        }
      }
    });

    // Write file data to stream
    uploadStream.end(req.file.buffer);

  } catch (error) {
    console.error('💥 Upload endpoint error:', error);
    return res.status(500).json({ error: "Upload failed", details: error.message });
  }
});

// Get all media
app.get("/api/media", async (req, res) => {
  try {
    const media = await Media.find().sort({ uploadDate: -1 });
    const items = media.map(item => ({
      id: item._id,
      name: item.originalName,
      size: humanSize(item.size),
      sizeBytes: item.size,
      modifiedAt: item.uploadDate.toISOString(),
      contentType: item.contentType,
      kind: item.metadata.type,
      source: 'mongodb',
      url: `/api/media/${item._id}/stream`
    }));

    return res.json({ items });
  } catch (error) {
    console.error('Error fetching media:', error);
    return res.status(500).json({ error: "Failed to load media" });
  }
});

// Stream media file
app.get("/api/media/:id/stream", async (req, res) => {
  try {
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid media ID format" });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    // Validate gridFsId exists
    if (!media.gridFsId) {
      console.error('💥 Media record missing gridFsId:', req.params.id);
      return res.status(500).json({ error: "File metadata corrupted" });
    }

    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });

    // Open download stream
    const downloadStream = bucket.openDownloadStream(media.gridFsId);

    // Handle stream errors
    downloadStream.on('error', (error) => {
      console.error('💥 Download stream error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Stream error", details: error.message });
      }
    });

    // Set response headers
    res.set({
      'Content-Type': media.contentType || 'application/octet-stream',
      'Content-Length': media.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });

    // Handle range requests for video/audio streaming
    const isStreamable = media.contentType?.startsWith("video/") || media.contentType?.startsWith("audio/");
    if (isStreamable && req.headers.range) {
      const parts = req.headers.range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : media.size - 1;

      if (start >= media.size || end >= media.size) {
        res.status(416);
        res.set('Content-Range', `bytes */${media.size}`);
        return res.send('Requested range not satisfiable');
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${media.size}`,
        'Content-Length': chunkSize
      });

      downloadStream.start(start);
    }

    // Pipe stream to response
    downloadStream.pipe(res);
  } catch (error) {
    console.error('💥 Stream error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to stream file", details: error.message });
    }
  }
});

// Download media file
app.get("/api/media/:id/download", async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });

    res.set({
      'Content-Type': media.contentType,
      'Content-Disposition': `attachment; filename="${media.originalName}"`
    });

    const downloadStream = bucket.openDownloadStream(media.gridFsId);
    downloadStream.pipe(res);
  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).json({ error: "Failed to download file" });
  }
});

// Delete media file
app.delete("/api/media/:id", async (req, res) => {
  try {
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid media ID format" });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    // Validate gridFsId exists
    if (!media.gridFsId) {
      console.error('💥 Media record missing gridFsId:', req.params.id);
      return res.status(500).json({ error: "File metadata corrupted" });
    }

    // Delete from GridFS
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });
    
    try {
      await bucket.delete(media.gridFsId);
    } catch (gridfsError) {
      console.error('⚠️ GridFS delete error:', gridfsError);
      // Continue with DB deletion even if GridFS deletion fails
    }

    // Delete from database
    await Media.findByIdAndDelete(req.params.id);

    console.log(`✅ File deleted: ${media._id} (${media.originalName})`);

    return res.json({
      message: "Deleted successfully",
      name: media.originalName
    });
  } catch (error) {
    console.error('💥 Delete error:', error);
    return res.status(500).json({ error: "Failed to delete file", details: error.message });
  }
});

// Backward compatibility endpoint
app.get("/media-list", async (req, res) => {
  try {
    const media = await Media.find().sort({ uploadDate: -1 });
    const response = media.map(item => ({
      name: item.filename,
      size: humanSize(item.size),
      type: item.metadata.type,
      url: `/api/media/${item._id}/stream`
    }));
    return res.json(response);
  } catch (error) {
    console.error('Error fetching media list:', error);
    return res.status(500).json({ error: "Failed to load media" });
  }
});

// 404 fallback
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.status(404).send("Not found");
});

// For local development
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Media server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
