require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const multer = require("multer");
const { GridFsStorage } = require('multer-gridfs-storage');
const { GridFSBucket } = require('mongodb');
const mime = require("mime-types");
const path = require('path');
const cors = require('cors');

const connectDB = require('./config/database');
const Media = require('./models/Media');

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// GridFS Storage for file uploads
const storage = new GridFsStorage({
  url: process.env.MONGODB_URI || 'mongodb://localhost:27017/mediaflow',
  options: { useNewUrlParser: true, useUnifiedTopology: true },
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      const filename = `${Date.now()}-${file.originalname.replace(/[^\w.\-() ]/g, "_").trim()}`;
      const fileInfo = {
        filename: filename,
        bucketName: 'uploads'
      };
      resolve(fileInfo);
    });
  }
});

const upload = multer({ storage });

// Authentication middleware
const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "change-me";

function unauthorized(res) {
  res.set("WWW-Authenticate", 'Basic realm="Mediaflow"');
  return res.status(401).send("Authentication required.");
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Basic ")) return unauthorized(res);

  const encoded = authHeader.slice(6).trim();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return unauthorized(res);

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
    return unauthorized(res);
  }

  return next();
}

// Apply auth middleware to all routes except health check
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  return authMiddleware(req, res, next);
});

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

// Upload endpoint
app.post("/api/upload", upload.single("media"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const { type, contentType } = detectType(req.file.filename);

    // Create media document
    const media = new Media({
      filename: req.file.filename,
      originalName: req.file.originalname,
      contentType: req.file.contentType,
      size: req.file.size,
      metadata: {
        type: type
      },
      gridFsId: req.file.id
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
