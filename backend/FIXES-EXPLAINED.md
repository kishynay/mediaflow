# Backend Fixes - Production Issues Resolved

## Overview
This document explains the critical fixes applied to resolve CORS errors and file upload crashes in the MERN stack deployment.

---

## Issue 1: CORS Error - "No 'Access-Control-Allow-Origin' Header"

### Root Cause
The original CORS configuration had a fatal flaw:
```javascript
// ❌ BROKEN - Empty array rejection
const allowedOrigins = ("").split(",").filter(Boolean); // Results in []
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true); // Always false!
    return callback(new Error('CORS policy: origin not allowed'), false);
  }
}));
```

When `CORS_ORIGINS` environment variable is not set or is empty:
- `allowedOrigins` becomes an empty array `[]`
- Any origin (including your Vercel frontend) fails the `includes()` check
- The browser blocks the request due to missing `Access-Control-Allow-Origin` header

### Solution Implemented
```javascript
// ✅ FIXED - Proper fallback and dynamic origin handling
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, mobile apps)
    if (!origin) return callback(null, true);
    
    // Allow localhost for local development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    
    // Allow configured production origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Reject unknown origins
    const err = new Error(`CORS policy: origin ${origin} not allowed`);
    console.warn(err.message);
    callback(err);
  },
  credentials: true,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests
```

### Environment Setup for Production
**For Vercel deployment**, set this environment variable in your backend:
```bash
CORS_ORIGINS=https://your-vercel-domain.vercel.app
```

**Multiple domains (if needed):**
```bash
CORS_ORIGINS=https://app.domain.com,https://api.domain.com,http://localhost:3000
```

### Why This Works
1. **Localhost fallback**: Development works without configuration
2. **Dynamic origin check**: Validates against environment variables
3. **Explicit preflight handling**: Ensures OPTIONS requests are responded to correctly
4. **Proper error logging**: Shows which origins are being rejected

---

## Issue 2: File Upload Crash - "Cannot read properties of undefined (reading '_id')"

### Root Cause
The GridFS upload stream had multiple critical issues:

```javascript
// ❌ BROKEN - Multiple problems:
uploadStream.end(req.file.buffer);

uploadStream.on('finish', async () => {
  // Problem 1: uploadStream.id might be undefined at this point
  // Problem 2: No validation that gridFsId was set
  // Problem 3: No error handling for stream failures
  // Problem 4: If DB save fails, orphaned file left in GridFS
  gridFsId: uploadStream.id  // Crashes if undefined!
});
```

### Solution Implemented
```javascript
// ✅ FIXED - Proper stream lifecycle and error handling
const uploadStream = bucket.openUploadStream(filename, {
  contentType: contentType || req.file.mimetype,
  metadata: { type, uploadedAt: new Date() }
});

// Handle stream errors BEFORE writing data
uploadStream.on('error', (error) => {
  console.error('GridFS upload stream error:', error);
  if (!res.headersSent) {
    return res.status(500).json({ error: "Upload stream failed" });
  }
});

// Handle completion AFTER stream finishes
uploadStream.on('finish', async () => {
  try {
    const gridFsId = uploadStream.id; // Safely capture after finish
    
    // Validate gridFsId exists
    if (!gridFsId) {
      console.error('gridFsId is undefined after upload');
      return res.status(500).json({ error: "Upload completed but file ID is missing" });
    }
    
    // Save to database
    const media = new Media({ ..., gridFsId });
    await media.save();
    
    return res.status(201).json({ message: "Upload successful" });
  } catch (dbError) {
    // Cleanup: Delete orphaned GridFS file if DB save fails
    try {
      const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
      if (uploadStream.id) {
        await bucket.delete(uploadStream.id);
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup orphaned file:', cleanupError);
    }
    return res.status(500).json({ error: "Database save failed" });
  }
});

// Write data to stream AFTER error handlers are set up
uploadStream.end(req.file.buffer);
```

### Key Improvements
1. **Error handlers first**: Attach error/finish handlers before writing data
2. **gridFsId validation**: Check if ID exists before using it
3. **Orphan cleanup**: Deletes GridFS file if database save fails
4. **Try-catch wrapping**: All async operations properly handled
5. **Response validation**: Check `res.headersSent` before sending response

---

## Issue 3: Unsupported Library Conflict

### Root Cause
`package.json` included `multer-gridfs-storage` but the code used `multer.memoryStorage()` instead.

This created:
- Unnecessary dependency
- Potential conflicts with stream handling
- Confusion about which library handles storage

### Solution
Removed the unused dependency:
```json
// ❌ REMOVED (conflicting)
"multer-gridfs-storage": "^5.0.2"

// ✅ KEPT (actually used)
"multer": "^1.4.2",
"mongodb": "^6.8.0"
```

The current approach (memory storage + manual GridFS upload) is cleaner and works perfectly with Render and Vercel.

---

## Issue 4: Missing Error Handling & Logging

### Improvements Added

#### Stream Endpoints
```javascript
// Better error handling and logging
downloadStream.on('error', (error) => {
  console.error('💥 Download stream error:', error);
  if (!res.headersSent) {
    return res.status(500).json({ error: "Stream error", details: error.message });
  }
});

// ID validation
if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
  return res.status(400).json({ error: "Invalid media ID format" });
}

// Metadata validation
if (!media.gridFsId) {
  console.error('Media record missing gridFsId:', req.params.id);
  return res.status(500).json({ error: "File metadata corrupted" });
}
```

#### Logging
Added emoji prefixes for easy debugging:
- ✅ Success operations
- ⚠️ Warnings (non-fatal issues)
- 💥 Critical errors

---

## Testing Checklist

### Local Development
```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
MONGODB_URI=mongodb://localhost:27017/mediaflow
CORS_ORIGINS=http://localhost:3000,http://localhost:8080
AUTH_ENABLED=false

# 3. Start server
npm start

# 4. Test upload
curl -X POST http://localhost:3000/api/upload \
  -F "media=@testfile.mp4"

# 5. Check health
curl http://localhost:3000/health
```

### Production (Render + Vercel)
```bash
# Environment variables to set in Render dashboard:
MONGODB_URI=<your-atlas-uri>
CORS_ORIGINS=https://your-app.vercel.app
JWT_SECRET=<strong-random-secret>
AUTH_USERNAME=admin
AUTH_PASSWORD=<strong-password>
AUTH_ENABLED=true
TOKEN_EXPIRY=24h
```

### Test Cases
1. ✅ Upload small file (< 1MB)
2. ✅ Upload large file (> 100MB)
3. ✅ Stream video/audio with range requests
4. ✅ Download file
5. ✅ Delete file
6. ✅ Check GridFS cleanup on DB error
7. ✅ Verify CORS headers in browser
8. ✅ Test auth token expiry

---

## Performance Considerations

### File Size Limits
Currently set to 500MB per file (configurable):
```javascript
const MAX_FILE_SIZE = 500 * 1024 * 1024;
```

For Render (2GB RAM), adjust based on testing:
- Increase: `1024 * 1024 * 1024` (1GB)
- Decrease: `100 * 1024 * 1024` (100MB)

### MongoDB Atlas
GridFS automatically chunks files > 255KB for optimal streaming and concurrent access.

### Streaming Optimization
Range request support enables:
- Video scrubbing without full download
- Audio seeking
- Resume capability for interrupted transfers

---

## Migration from Old Code

### For Existing Users
1. **Backup data**: Export MongoDB collections before deploying
2. **No schema changes**: Existing files remain compatible
3. **Deploy new code**: Rolling restart on Render
4. **Verify health**: `curl https://your-backend.onrender.com/health`
5. **Test endpoints**: Upload and stream a test file

### Rollback Plan
If issues occur:
1. Revert to previous git commit
2. `npm install` to restore original packages
3. Restart Render deployment

---

## Common Issues & Solutions

| Issue | Cause | Fix |
|-------|-------|-----|
| CORS still blocked | `CORS_ORIGINS` not set | Set environment variable in Render |
| Upload hangs | File > 500MB | Increase `MAX_FILE_SIZE` or split file |
| GridFS not found | Empty `allowedOrigins` | Use proper CORS configuration |
| Auth fails | Wrong secret | Ensure `JWT_SECRET` is set consistently |
| Stream 404s | Corrupted `gridFsId` | Check MongoDB Atlas collection |

---

## Summary of Changes

| File | Changes | Impact |
|------|---------|--------|
| `server.js` | CORS, upload, stream error handling | Fixes crashes & CORS errors |
| `package.json` | Remove unused `multer-gridfs-storage` | Removes conflicts |
| New: `FIXES-EXPLAINED.md` | Documentation | Helps future debugging |

---

## Support

For additional issues:
1. Check `/health` endpoint
2. Review Render logs: `render logs <service-id>`
3. Verify MongoDB Atlas network access
4. Test CORS with: `curl -H "Origin: your-frontend" -I backend-url`
