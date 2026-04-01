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

const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS policy: origin not allowed'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', (req, res) => res.sendStatus(204));
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
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, database: 'disconnected', error: error.message });
  }
});

// Auth login endpoint
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  return res.json({ token, expiresIn: TOKEN_EXPIRY });
});

// Upload endpoint
app.post("/api/upload", upload.single("media"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const { type, contentType } = detectType(req.file.originalname);

    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const filename = `${Date.now()}-${req.file.originalname.replace(/[^\w.\-() ]/g, "_").trim()}`;

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: req.file.mimetype,
      metadata: { type }
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on('finish', async () => {
      const media = new Media({
        filename: filename,
        originalName: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size,
        metadata: { type },
        gridFsId: uploadStream.id
      });

      await media.save();

      return res.status(201).json({
        message: "Upload successful.",
        item: {
          id: media._id,
          name: media.originalName,
          size: humanSize(media.size),
          type: media.metadata.type,
          contentType: media.contentType,
          url: `/api/media/${media._id}/stream`,
          uploadDate: media.uploadDate
        }
      });
    });

    uploadStream.on('error', (error) => {
      console.error('Upload stream error:', error);
      return res.status(500).json({ error: "Upload failed" });
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: "Upload failed" });
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
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });

    const downloadStream = bucket.openDownloadStream(media.gridFsId);

    downloadStream.on('error', (error) => {
      console.error('Stream error:', error);
      return res.status(500).json({ error: "Stream error" });
    });

    // Set headers
    res.set({
      'Content-Type': media.contentType,
      'Content-Length': media.size,
      'Accept-Ranges': 'bytes'
    });

    // Handle range requests for video/audio streaming
    const isStreamable = media.contentType.startsWith("video/") || media.contentType.startsWith("audio/");
    if (isStreamable && req.headers.range) {
      const parts = req.headers.range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : media.size - 1;

      if (start >= media.size || end >= media.size) {
        res.status(416).send('Requested range not satisfiable');
        return;
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${media.size}`,
        'Content-Length': chunkSize
      });

      downloadStream.start(start);
    }

    downloadStream.pipe(res);
  } catch (error) {
    console.error('Stream error:', error);
    return res.status(500).json({ error: "Failed to stream file" });
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
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    // Delete from GridFS
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });
    await bucket.delete(media.gridFsId);

    // Delete from database
    await Media.findByIdAndDelete(req.params.id);

    return res.json({
      message: "Deleted",
      name: media.originalName
    });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ error: "Failed to delete file" });
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
