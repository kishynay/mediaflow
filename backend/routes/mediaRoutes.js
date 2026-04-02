const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const mime = require("mime-types");

const Media = require("../models/Media");
const authMiddleware = require("../middleware/auth");

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

function getBucketName() {
  return process.env.GRIDFS_BUCKET || process.env.GRIDFS_BUCKET_NAME || "uploads";
}

function getDbName() {
  return mongoose.connection?.db?.databaseName || mongoose.connection?.name || "unknown";
}

function getBucket() {
  if (!mongoose.connection?.db) {
    throw new Error("MongoDB is not connected");
  }

  return new GridFSBucket(mongoose.connection.db, { bucketName: getBucketName() });
}

function getFilesCollection() {
  if (!mongoose.connection?.db) {
    throw new Error("MongoDB is not connected");
  }

  return mongoose.connection.db.collection(`${getBucketName()}.files`);
}

function getMediaCollection() {
  if (!mongoose.connection?.db) {
    throw new Error("MongoDB is not connected");
  }

  return mongoose.connection.db.collection(Media.collection.name);
}

function normalizeKind(kind, contentType, fileName) {
  if (kind) return kind;

  if (contentType?.startsWith("video/")) return "video";
  if (contentType?.startsWith("audio/")) return "audio";
  if (contentType?.startsWith("image/")) return "image";

  return detectType(fileName || "").type;
}

function toSafeIso(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

function toSafeSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return 0;
  return size;
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(String(id));
}

function toErrorDetails(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || "Unknown error",
    code: error?.code || null
  };
}

function logMediaEvent(event, details = {}, level = "log") {
  const logger = console[level] || console.log;
  logger(`[media:${event}]`, {
    env: process.env.NODE_ENV || "development",
    db: getDbName(),
    bucket: getBucketName(),
    ...details
  });
}

function buildUploadErrorResponse(error, maxFileSize) {
  if (!error) {
    return { status: 500, body: { error: "Upload failed" } };
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return {
        status: 413,
        body: {
          error: `File size exceeds ${Math.floor(maxFileSize / (1024 * 1024))}MB limit`
        }
      };
    }

    return {
      status: 400,
      body: { error: "Upload validation failed", details: error.message }
    };
  }

  return {
    status: 500,
    body: { error: "Upload failed", details: error.message || "Unknown error" }
  };
}

async function resolveMediaTarget(id) {
  const objectId = toObjectId(id);
  if (!objectId) {
    return { found: false, status: 400, error: "Invalid media ID format" };
  }

  const filesCollection = getFilesCollection();
  const mediaCollection = getMediaCollection();
  const idVariants = [objectId, String(objectId)];

  const [mediaById, mediaByGridFsIdRaw, gridFsFileById] = await Promise.all([
    Media.findById(objectId).lean(),
    mediaCollection.findOne({ gridFsId: { $in: idVariants } }),
    filesCollection.findOne({ _id: objectId })
  ]);

  const mediaByGridFsId = mediaByGridFsIdRaw
    ? {
      ...mediaByGridFsIdRaw,
      _id: toObjectId(mediaByGridFsIdRaw._id) || mediaByGridFsIdRaw._id,
      gridFsId: toObjectId(mediaByGridFsIdRaw.gridFsId) || mediaByGridFsIdRaw.gridFsId
    }
    : null;

  if (mediaById?.gridFsId) {
    const normalizedGridFsId = toObjectId(mediaById.gridFsId) || mediaById.gridFsId;
    const sameId = String(normalizedGridFsId) === String(objectId);
    const gridFsFile = sameId ? gridFsFileById : await filesCollection.findOne({ _id: normalizedGridFsId });
    return {
      found: true,
      resolvedBy: "media-document-id",
      gridFsId: normalizedGridFsId,
      mediaDoc: mediaById,
      gridFsFile
    };
  }

  if (mediaByGridFsId || gridFsFileById) {
    return {
      found: true,
      resolvedBy: mediaByGridFsId ? "gridfs-id-with-media-doc" : "gridfs-id-only",
      gridFsId: objectId,
      mediaDoc: mediaByGridFsId || null,
      gridFsFile: gridFsFileById || null
    };
  }

  return { found: false, status: 404, error: "File not found" };
}

async function listMediaItems() {
  const bucketName = getBucketName();
  const dbName = getDbName();
  const filesCollection = getFilesCollection();
  const mediaCollection = getMediaCollection();

  const gridFsFiles = await filesCollection
    .find(
      {},
      {
        projection: {
          _id: 1,
          filename: 1,
          length: 1,
          uploadDate: 1,
          contentType: 1,
          metadata: 1
        }
      }
    )
    .sort({ uploadDate: -1 })
    .toArray();

  const gridFsIds = gridFsFiles.map((file) => file._id);
  const mediaDocs = gridFsIds.length
    ? await mediaCollection
      .find(
        { gridFsId: { $in: [...gridFsIds, ...gridFsIds.map((id) => String(id))] } },
        {
          projection: {
            _id: 1,
            originalName: 1,
            contentType: 1,
            size: 1,
            uploadDate: 1,
            metadata: 1,
            gridFsId: 1
          }
        }
      )
      .toArray()
    : [];

  const mediaByGridFsId = new Map();
  for (const doc of mediaDocs) {
    mediaByGridFsId.set(String(doc.gridFsId), doc);
  }

  const items = gridFsFiles.map((fileDoc) => {
    const mediaDoc = mediaByGridFsId.get(String(fileDoc._id));
    const sizeBytes = toSafeSize(mediaDoc?.size ?? fileDoc.length);
    const contentType = mediaDoc?.contentType
      || fileDoc.contentType
      || mime.lookup(mediaDoc?.originalName || fileDoc.filename || "")
      || "application/octet-stream";
    const name = mediaDoc?.originalName || fileDoc.metadata?.originalName || fileDoc.filename;
    const kind = normalizeKind(mediaDoc?.metadata?.type || fileDoc.metadata?.type, contentType, name);
    const modifiedAt = toSafeIso(mediaDoc?.uploadDate || fileDoc.uploadDate);

    return {
      id: String(fileDoc._id),
      mediaId: mediaDoc?._id ? String(mediaDoc._id) : null,
      name,
      size: sizeBytes,
      sizeBytes,
      sizeLabel: humanSize(sizeBytes),
      modifiedAt,
      contentType,
      kind,
      source: mediaDoc ? "gridfs+media" : "gridfs",
      url: `/api/media/${fileDoc._id.toString()}/stream`
    };
  });

  const orphanedCount = items.filter((item) => item.source === "gridfs").length;

  return {
    items,
    debug: {
      env: process.env.NODE_ENV || "development",
      dbName,
      bucketName,
      gridFsFilesCount: gridFsFiles.length,
      mediaDocsCount: mediaDocs.length,
      orphanedGridFsCount: orphanedCount,
      sampleGridFsIds: items.slice(0, 10).map((item) => item.id),
      sampleOrphanedIds: items.filter((item) => item.source === "gridfs").slice(0, 10).map((item) => item.id)
    }
  };
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
    const safeOriginalName = req.file.originalname.replace(/[^\w.\-() ]/g, "_").trim() || "upload";
    const filename = `${Date.now()}-${safeOriginalName}`;

    logMediaEvent("upload:start", {
      originalName: req.file.originalname,
      filename,
      mimeType: req.file.mimetype || null,
      detectedContentType: contentType || req.file.mimetype || null,
      detectedType: type,
      sizeBytes: req.file.size
    });

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: contentType || req.file.mimetype,
      metadata: {
        type,
        uploadedAt: new Date(),
        originalName: req.file.originalname
      }
    });

    uploadStream.on("error", (error) => {
      logMediaEvent("upload:gridfs-error", {
        originalName: req.file?.originalname || null,
        filename,
        ...toErrorDetails(error)
      }, "error");

      if (!res.headersSent) {
        return res.status(500).json({ error: "Upload stream failed", details: error.message });
      }

      return res.destroy(error);
    });

    uploadStream.on("finish", async () => {
      const gridFsId = uploadStream.id;

      if (!gridFsId) {
        logMediaEvent("upload:missing-gridfs-id", {
          originalName: req.file?.originalname || null,
          filename
        }, "error");

        if (!res.headersSent) {
          return res.status(500).json({ error: "Upload completed but file ID is missing" });
        }
        return;
      }

      try {
        const media = await Media.create({
          filename,
          originalName: req.file.originalname,
          contentType: contentType || req.file.mimetype,
          size: req.file.size,
          metadata: { type },
          gridFsId
        });

        logMediaEvent("upload:success", {
          originalName: req.file.originalname,
          filename,
          mediaId: String(media._id),
          gridFsId: String(gridFsId),
          sizeBytes: media.size,
          detectedType: media.metadata?.type || type
        });

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
        logMediaEvent("upload:media-save-failed", {
          originalName: req.file.originalname,
          filename,
          gridFsId: String(gridFsId),
          ...toErrorDetails(dbError)
        }, "error");

        try {
          await getBucket().delete(gridFsId);
          logMediaEvent("upload:rollback-success", {
            originalName: req.file.originalname,
            filename,
            gridFsId: String(gridFsId)
          }, "warn");
        } catch (rollbackError) {
          logMediaEvent("upload:rollback-failed", {
            originalName: req.file.originalname,
            filename,
            gridFsId: String(gridFsId),
            rollback: toErrorDetails(rollbackError)
          }, "error");
        }

        if (!res.headersSent) {
          return res.status(500).json({ error: "Upload failed during database save", details: dbError.message });
        }
      }
    });

    uploadStream.end(req.file.buffer);
  } catch (error) {
    logMediaEvent("upload:handler-error", {
      originalName: req.file?.originalname || null,
      ...toErrorDetails(error)
    }, "error");

    return res.status(500).json({ error: "Upload failed", details: error.message });
  }
}

router.get("/", authMiddleware, async (req, res) => {
  try {
    if (!mongoose.connection?.db) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const { items, debug } = await listMediaItems();

    logMediaEvent("list", {
      files: debug.gridFsFilesCount,
      mediaDocs: debug.mediaDocsCount,
      orphaned: debug.orphanedGridFsCount,
      firstIds: debug.sampleGridFsIds.slice(0, 5)
    });

    if (req.query.debug === "1") {
      return res.json({ items, debug });
    }

    return res.json({ items });
  } catch (error) {
    logMediaEvent("list:error", toErrorDetails(error), "error");
    return res.status(500).json({ error: "Failed to load media", details: error.message });
  }
});

router.post("/upload", authMiddleware, (req, res, next) => {
  const maxFileSize = Number(process.env.MAX_FILE_SIZE_BYTES || 500 * 1024 * 1024);

  upload.single("media")(req, res, (error) => {
    if (error) {
      const response = buildUploadErrorResponse(error, maxFileSize);
      logMediaEvent("upload:middleware-error", {
        originalName: req.file?.originalname || null,
        ...toErrorDetails(error)
      }, response.status >= 500 ? "error" : "warn");
      return res.status(response.status).json(response.body);
    }

    return uploadHandler(req, res, next);
  });
});

router.get("/:id/stream", async (req, res) => {
  try {
    if (!mongoose.connection?.db) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const resolved = await resolveMediaTarget(req.params.id);
    if (!resolved.found) {
      return res.status(resolved.status || 404).json({ error: resolved.error || "File not found" });
    }

    const { mediaDoc, gridFsFile, gridFsId, resolvedBy } = resolved;

    if (!gridFsId) {
      return res.status(500).json({ error: "File metadata corrupted" });
    }

    const bucket = getBucket();
    const totalSize = toSafeSize(mediaDoc?.size ?? gridFsFile?.length);
    const contentType = mediaDoc?.contentType
      || gridFsFile?.contentType
      || mime.lookup(mediaDoc?.originalName || gridFsFile?.filename || "")
      || "application/octet-stream";
    const rangeHeader = req.headers.range;

    let start = 0;
    let end = Math.max(totalSize - 1, 0);
    let isPartial = false;

    if (rangeHeader) {
      if (totalSize <= 0) {
        res.set("Content-Range", "bytes */0");
        return res.status(416).end();
      }

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
        end = totalSize - 1;
      } else {
        start = Number.parseInt(startStr, 10);
        end = endStr ? Number.parseInt(endStr, 10) : (totalSize - 1);
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

      downloadStream = bucket.openDownloadStream(gridFsId, { start, end: end + 1 });
    } else {
      res.status(200);
      if (totalSize > 0) {
        res.set({
          ...baseHeaders,
          "Content-Length": totalSize
        });
      } else {
        res.set(baseHeaders);
      }

      downloadStream = bucket.openDownloadStream(gridFsId);
    }

    logMediaEvent("stream", {
      requestId: req.params.id,
      resolvedBy,
      gridFsId: String(gridFsId),
      sizeBytes: totalSize,
      contentType,
      range: rangeHeader || "none"
    });

    downloadStream.on("error", (error) => {
      const message = String(error?.message || "");
      const isMissingFile = error?.code === "FileNotFound" || /FileNotFound|not found/i.test(message);

      logMediaEvent("stream:error", {
        requestId: req.params.id,
        resolvedBy,
        gridFsId: String(gridFsId),
        ...toErrorDetails(error)
      }, isMissingFile ? "warn" : "error");

      if (res.headersSent) {
        return res.destroy(error);
      }

      if (isMissingFile) {
        return res.status(404).json({ error: "File content not found in GridFS" });
      }

      return res.status(500).json({ error: "Failed to stream file", details: message });
    });

    downloadStream.pipe(res);
  } catch (error) {
    logMediaEvent("stream:handler-error", {
      requestId: req.params.id,
      ...toErrorDetails(error)
    }, "error");

    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to stream file", details: error.message });
    }
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    const resolved = await resolveMediaTarget(req.params.id);
    if (!resolved.found) {
      return res.status(resolved.status || 404).json({ error: resolved.error || "File not found" });
    }

    const media = resolved.mediaDoc || null;
    const gridFsFile = resolved.gridFsFile || null;
    const safeName = String(media?.originalName || gridFsFile?.filename || "download").replace(/"/g, "");

    res.set({
      "Content-Type": media?.contentType || gridFsFile?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`
    });

    const downloadStream = getBucket().openDownloadStream(resolved.gridFsId);

    downloadStream.on("error", (error) => {
      logMediaEvent("download:error", {
        requestId: req.params.id,
        gridFsId: String(resolved.gridFsId),
        ...toErrorDetails(error)
      }, "error");

      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to download file", details: error.message });
      }

      return res.destroy(error);
    });

    downloadStream.pipe(res);
  } catch (error) {
    logMediaEvent("download:handler-error", {
      requestId: req.params.id,
      ...toErrorDetails(error)
    }, "error");

    return res.status(500).json({ error: "Failed to download file", details: error.message });
  }
});

router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const resolved = await resolveMediaTarget(req.params.id);
    if (!resolved.found) {
      return res.status(resolved.status || 404).json({ error: resolved.error || "File not found" });
    }

    try {
      await getBucket().delete(resolved.gridFsId);
    } catch (error) {
      logMediaEvent("delete:gridfs-delete-failed", {
        requestId: req.params.id,
        gridFsId: String(resolved.gridFsId),
        ...toErrorDetails(error)
      }, "warn");
    }

    if (resolved.mediaDoc?._id) {
      await Media.findByIdAndDelete(resolved.mediaDoc._id);
    } else {
      await getMediaCollection().deleteOne({
        gridFsId: { $in: [resolved.gridFsId, String(resolved.gridFsId)] }
      });
    }

    logMediaEvent("delete:success", {
      requestId: req.params.id,
      gridFsId: String(resolved.gridFsId),
      mediaId: resolved.mediaDoc?._id ? String(resolved.mediaDoc._id) : null
    });

    return res.json({
      message: "Deleted successfully",
      name: resolved.mediaDoc?.originalName || resolved.gridFsFile?.filename || req.params.id
    });
  } catch (error) {
    logMediaEvent("delete:error", {
      requestId: req.params.id,
      ...toErrorDetails(error)
    }, "error");

    return res.status(500).json({ error: "Failed to delete file", details: error.message });
  }
});

module.exports = {
  router,
  uploadMiddleware: upload.single("media"),
  uploadHandler,
  listMediaItems
};
