# Before & After: Code Comparison

## 1. CORS Configuration

### ❌ BEFORE (Broken)
```javascript
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS policy: origin not allowed'), false);  // ❌ Too strict!
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', (req, res) => res.sendStatus(204));
```

**Problems:**
- If `CORS_ORIGINS` is empty, `allowedOrigins = []`
- Any origin fails the check and gets rejected
- No localhost support
- Missing `Content-Disposition` header for downloads

### ✅ AFTER (Fixed)
```javascript
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin or mobile apps)
    if (!origin) return callback(null, true);
    
    // Allow localhost for local development ✅ NEW
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
  exposedHeaders: ['Content-Range', 'X-Total-Count', 'Content-Disposition'],  // ✅ Added
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400  // ✅ NEW - Cache preflight for 24h
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));  // ✅ Explicit preflight handling
```

**Improvements:**
- Localhost automatically allowed
- Proper fallback handling
- Production origin support
- CORS caching for performance
- Better error logging

---

## 2. File Upload Endpoint

### ❌ BEFORE (Crashes)
```javascript
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

    uploadStream.end(req.file.buffer);  // ❌ Writing before error handlers!

    uploadStream.on('finish', async () => {
      const media = new Media({
        filename: filename,
        originalName: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size,
        metadata: { type },
        gridFsId: uploadStream.id  // ❌ Can be undefined!
      });

      await media.save();  // ❌ No error handling - orphans result

      return res.status(201).json({ /* ... */ });
    });

    uploadStream.on('error', (error) => {  // ❌ Attached after writing!
      console.error('Upload stream error:', error);
      return res.status(500).json({ error: "Upload failed" });
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: "Upload failed" });
  }
});
```

**Problems:**
- Error handlers attached AFTER data written
- `uploadStream.id` may be undefined
- No file size validation
- No cleanup on DB error (orphaned files)
- No gridFsId validation
- Missing error logging

### ✅ AFTER (Production-Ready)
```javascript
app.post("/api/upload", upload.single("media"), async (req, res) => {
  try {
    // Validate file was uploaded ✅ NEW
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Validate file size ✅ NEW
    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(413).json({ error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` });
    }

    const { type, contentType } = detectType(req.file.originalname);

    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const filename = `${Date.now()}-${req.file.originalname.replace(/[^\w.\-() ]/g, "_").trim()}`;

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: contentType || req.file.mimetype,
      metadata: { 
        type,
        uploadedAt: new Date()  // ✅ NEW
      }
    });

    // Handle stream errors FIRST ✅ NEW
    uploadStream.on('error', (error) => {
      console.error('💥 GridFS upload stream error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Upload stream failed", details: error.message });
      }
    });

    // Handle successful upload with full error handling ✅ IMPROVED
    uploadStream.on('finish', async () => {
      try {
        const gridFsId = uploadStream.id;

        // Validate gridFsId ✅ NEW
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
        
        // Cleanup orphaned GridFS file ✅ NEW
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

    // Write file data to stream AFTER error handlers ✅ MOVED
    uploadStream.end(req.file.buffer);

  } catch (error) {
    console.error('💥 Upload endpoint error:', error);
    return res.status(500).json({ error: "Upload failed", details: error.message });
  }
});
```

**Improvements:**
- Error handlers attached BEFORE writing data
- File size validation (500MB limit)
- gridFsId validation before use
- Orphaned file cleanup on DB error
- Detailed error messages with context
- Better logging with emoji indicators

---

## 3. Stream Download Endpoint

### ❌ BEFORE (Can crash)
```javascript
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

    res.set({
      'Content-Type': media.contentType,
      'Content-Length': media.size,
      'Accept-Ranges': 'bytes'
    });

    // Range request code...
    downloadStream.pipe(res);
  } catch (error) {
    console.error('Stream error:', error);
    return res.status(500).json({ error: "Failed to stream file" });
  }
});
```

**Problems:**
- No ID format validation
- No check if gridFsId exists (can cause crashes)
- Crashes if media record corrupted
- Missing Cache-Control header

### ✅ AFTER (Robust)
```javascript
app.get("/api/media/:id/stream", async (req, res) => {
  try {
    // Validate ID format ✅ NEW
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid media ID format" });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    // Validate gridFsId exists ✅ NEW
    if (!media.gridFsId) {
      console.error('💥 Media record missing gridFsId:', req.params.id);
      return res.status(500).json({ error: "File metadata corrupted" });
    }

    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });

    const downloadStream = bucket.openDownloadStream(media.gridFsId);

    downloadStream.on('error', (error) => {
      console.error('💥 Download stream error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Stream error", details: error.message });
      }
    });

    res.set({
      'Content-Type': media.contentType || 'application/octet-stream',
      'Content-Length': media.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'  // ✅ NEW
    });

    // Range request code...
    downloadStream.pipe(res);
  } catch (error) {
    console.error('💥 Stream error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to stream file", details: error.message });
    }
  }
});
```

**Improvements:**
- ObjectId format validation
- gridFsId existence check
- Prevents corrupted metadata crashes
- Added Cache-Control headers
- Better error handling

---

## 4. Package Dependencies

### ❌ BEFORE (Conflicting)
```json
"dependencies": {
  "express": "^4.21.2",
  "mime-types": "^2.1.35",
  "multer": "^1.4.2",
  "mongodb": "^6.8.0",
  "mongoose": "^8.6.0",
  "multer-gridfs-storage": "^5.0.2",  // ❌ UNUSED
  "cors": "^2.8.5",
  "dotenv": "^16.4.5",
  "jsonwebtoken": "^9.0.0"
}
```

### ✅ AFTER (Clean)
```json
"dependencies": {
  "express": "^4.21.2",
  "mime-types": "^2.1.35",
  "multer": "^1.4.2",
  "mongodb": "^6.8.0",
  "mongoose": "^8.6.0",
  "cors": "^2.8.5",
  "dotenv": "^16.4.5",
  "jsonwebtoken": "^9.0.0"
}
```

**Improvement:** Removed unused dependency

---

## Summary of Changes

| Aspect | Before | After |
|--------|--------|-------|
| CORS | Rejects all origins if env var empty | Smart fallback with localhost support |
| Error Handlers | Attached after writing | Attached before writing |
| gridFsId | Used without validation | Validated before use |
| Orphan Files | Can pile up | Automatically cleaned up |
| Logging | Generic messages | Detailed with emoji indicators |
| File Size | Unlimited (can crash) | Limited to 500MB |
| ID Validation | None | ObjectId format checked |
| Metadata Validation | None | gridFsId existence checked |
| Dependencies | Has unused package | Clean, all used |
| Production Ready | No | Yes ✅ |

All changes maintain **100% backward compatibility** with existing files and schemas.
