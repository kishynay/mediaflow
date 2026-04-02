const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const mime = require("mime-types");

const Media = require("../models/Media");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE_BYTES || 500 * 1024 * 1024)
  }
});

function detectType(fileName) {
  const contentType = mime.lookup(fileName) || "application/octet-stream";
  if (contentType.startsWith("video/")) return { type: "video", contentType };
  if (contentType.startsWith("audio/")) return { type: "audio", contentType };
  if (contentType.startsWith("image/")) return { type: "image", contentType };

  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (["mp4", "mkv", "webm", "mov", "avi", "m4v"].includes(ext)) return { type: "video", contentType };
  if (["mp3", "wav", "flac", "m4a", "aac", "ogg"].includes(ext)) return { type: "audio", contentType };
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return { type: "image", contentType };
  return { type: "other", contentType };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getBucket() {
  return new GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });
}

async function uploadHandler(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const maxFileSize = Number(process.env.MAX_FILE_SIZE_BYTES || 500 * 1024 * 1024);
    if (req.file.size > maxFileSize) {
      return res.status(413).json({ error: `File size exceeds ${Math.floor(maxFileSize / (1024 * 1024))}MB limit` });
    }

    const { type, contentType } = detectType(req.file.originalname);
    const bucket = getBucket();
    const safeOriginalName = req.file.originalname.replace(/[^\w.\-() ]/g, "_").trim();
    const filename = `${Date.now()}-${safeOriginalName}`;

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: contentType || req.file.mimetype,
      metadata: {
        type,
        uploadedAt: new Date()
      }
    });

    uploadStream.on("error", (error) => {
      if (!res.headersSent) {
        return res.status(500).json({ error: "Upload stream failed", details: error.message });
      }
    });

    uploadStream.on("finish", async () => {
      try {
        const gridFsId = uploadStream.id;
        if (!gridFsId) {
          if (!res.headersSent) {
            return res.status(500).json({ error: "Upload completed but file ID is missing" });
          }
          return;
        }

        const media = new Media({
          filename,
          originalName: req.file.originalname,
          contentType: contentType || req.file.mimetype,
          size: req.file.size,
          metadata: { type },
          gridFsId
        });

        await media.save();

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
        try {
          if (uploadStream.id) {
            await getBucket().delete(uploadStream.id);
          }
        } catch (_) {
          // best effort cleanup
        }

        if (!res.headersSent) {
          return res.status(500).json({ error: "Upload failed during database save", details: dbError.message });
        }
      }
    });

    uploadStream.end(req.file.buffer);
  } catch (error) {
    return res.status(500).json({ error: "Upload failed", details: error.message });
  }
}

router.get("/", async (req, res) => {
  try {
    const media = await Media.find().sort({ uploadDate: -1 });
    const items = media.map((item) => ({
      id: item._id,
      name: item.originalName,
      size: humanSize(item.size),
      sizeBytes: item.size,
      modifiedAt: item.uploadDate.toISOString(),
      contentType: item.contentType,
      kind: item.metadata.type,
      source: "mongodb",
      url: `/api/media/${item._id}/stream`
    }));

    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load media", details: error.message });
  }
});

router.post("/upload", upload.single("media"), uploadHandler);

router.get("/:id/stream", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid media ID format" });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    if (!media.gridFsId) {
      return res.status(500).json({ error: "File metadata corrupted" });
    }

    const bucket = getBucket();
    const totalSize = Number(media.size || 0);
    const contentType = media.contentType || "application/octet-stream";
    const rangeHeader = req.headers.range;

    let start = 0;
    let end = totalSize > 0 ? totalSize - 1 : 0;
    let isPartial = false;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim().split(",")[0]);
      if (!match) {
        res.set("Content-Range", `bytes */${totalSize}`);
        return res.status(416).end();
      }

      const startStr = match[1];
      const endStr = match[2];

      if (!startStr && !endStr) {
        res.set("Content-Range", `bytes */${totalSize}`);
        return res.status(416).end();
      }

      if (!startStr) {
        const suffixLength = Number.parseInt(endStr, 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
          res.set("Content-Range", `bytes */${totalSize}`);
          return res.status(416).end();
        }
        start = Math.max(totalSize - suffixLength, 0);
        end = totalSize > 0 ? totalSize - 1 : 0;
      } else {
        start = Number.parseInt(startStr, 10);
        end = endStr ? Number.parseInt(endStr, 10) : (totalSize > 0 ? totalSize - 1 : 0);
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSize) {
        res.set("Content-Range", `bytes */${totalSize}`);
        return res.status(416).end();
      }

      end = Math.min(end, totalSize - 1);
      isPartial = true;
    }

    const baseHeaders = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600"
    };

    let downloadStream;

    if (isPartial) {
      const chunkSize = end - start + 1;
      res.status(206);
      res.set({
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": chunkSize
      });

      // GridFS end is non-inclusive; HTTP end is inclusive.
      downloadStream = bucket.openDownloadStream(media.gridFsId, { start, end: end + 1 });
    } else {
      res.status(200);
      res.set({
        ...baseHeaders,
        "Content-Length": totalSize
      });

      downloadStream = bucket.openDownloadStream(media.gridFsId);
    }

    downloadStream.on("error", (error) => {
      if (res.headersSent) {
        return res.destroy(error);
      }

      const message = String(error?.message || "");
      const isMissingFile = error?.code === "FileNotFound" || /FileNotFound|not found/i.test(message);
      if (isMissingFile) {
        return res.status(404).json({ error: "File content not found in GridFS" });
      }

      return res.status(500).json({ error: "Failed to stream file", details: message });
    });

    downloadStream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to stream file", details: error.message });
    }
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid media ID format" });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    const safeName = String(media.originalName || "download").replace(/"/g, "");

    res.set({
      "Content-Type": media.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`
    });

    const downloadStream = getBucket().openDownloadStream(media.gridFsId);

    downloadStream.on("error", (error) => {
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to download file", details: error.message });
      }
      return res.destroy(error);
    });

    downloadStream.pipe(res);
  } catch (error) {
    return res.status(500).json({ error: "Failed to download file", details: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid media ID format" });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: "File not found" });
    }

    if (!media.gridFsId) {
      return res.status(500).json({ error: "File metadata corrupted" });
    }

    try {
      await getBucket().delete(media.gridFsId);
    } catch (_) {
      // Continue DB delete even if GridFS delete fails.
    }

    await Media.findByIdAndDelete(req.params.id);

    return res.json({
      message: "Deleted successfully",
      name: media.originalName
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete file", details: error.message });
  }
});

module.exports = {
  router,
  uploadMiddleware: upload.single("media"),
  uploadHandler
};
