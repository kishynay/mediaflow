require("dotenv").config();

const mongoose = require("mongoose");
const mime = require("mime-types");

const connectDB = require("../config/database");
const Media = require("../models/Media");

function getBucketName() {
  return process.env.GRIDFS_BUCKET || "uploads";
}

function detectType(fileName, contentType) {
  const resolvedContentType = contentType || mime.lookup(fileName || "") || "application/octet-stream";

  if (resolvedContentType.startsWith("video/")) return { type: "video", contentType: resolvedContentType };
  if (resolvedContentType.startsWith("audio/")) return { type: "audio", contentType: resolvedContentType };
  if (resolvedContentType.startsWith("image/")) return { type: "image", contentType: resolvedContentType };

  const ext = (String(fileName || "").split(".").pop() || "").toLowerCase();
  if (["mp4", "mkv", "webm", "mov", "avi", "m4v"].includes(ext)) return { type: "video", contentType: resolvedContentType };
  if (["mp3", "wav", "flac", "m4a", "aac", "ogg"].includes(ext)) return { type: "audio", contentType: resolvedContentType };
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return { type: "image", contentType: resolvedContentType };

  return { type: "other", contentType: resolvedContentType };
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function main() {
  await connectDB();

  if (!mongoose.connection?.db) {
    throw new Error("MongoDB connection is not ready");
  }

  const db = mongoose.connection.db;
  const bucketName = getBucketName();
  const filesCollection = db.collection(`${bucketName}.files`);
  const mediaCollection = db.collection(Media.collection.name);

  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(0, Number.parseInt(limitArg.split("=")[1], 10) || 0) : 0;

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
  const existingDocs = gridFsIds.length
    ? await mediaCollection
      .find(
        { gridFsId: { $in: [...gridFsIds, ...gridFsIds.map((id) => String(id))] } },
        { projection: { _id: 1, gridFsId: 1, originalName: 1 } }
      )
      .toArray()
    : [];

  const existingIdSet = new Set(existingDocs.map((doc) => String(doc.gridFsId)));
  const missingFiles = gridFsFiles.filter((file) => !existingIdSet.has(String(file._id)));
  const filesToProcess = limit > 0 ? missingFiles.slice(0, limit) : missingFiles;

  console.log(`[reconcile] env=${process.env.NODE_ENV || "development"} db=${db.databaseName} bucket=${bucketName} totalGridFsFiles=${gridFsFiles.length} existingMediaDocs=${existingDocs.length} missingMediaDocs=${missingFiles.length} dryRun=${dryRun}`);

  if (!filesToProcess.length) {
    console.log("[reconcile] Nothing to reconcile.");
    return;
  }

  let createdCount = 0;
  let skippedCount = missingFiles.length - filesToProcess.length;
  let failedCount = 0;

  for (const file of filesToProcess) {
    const originalName = file.metadata?.originalName || file.filename || String(file._id);
    const resolved = detectType(originalName, file.contentType);
    const payload = {
      filename: file.filename || originalName,
      originalName,
      contentType: resolved.contentType,
      size: Number(file.length) || 0,
      uploadDate: toDate(file.uploadDate),
      metadata: {
        type: file.metadata?.type || resolved.type
      },
      gridFsId: file._id
    };

    if (dryRun) {
      console.log(`[reconcile] dry-run create gridFsId=${String(file._id)} originalName=${originalName}`);
      continue;
    }

    try {
      const existing = await mediaCollection.findOne({
        gridFsId: { $in: [file._id, String(file._id)] }
      });

      if (existing) {
        console.log(`[reconcile] skip-existing gridFsId=${String(file._id)} mediaId=${String(existing._id)}`);
        skippedCount += 1;
        continue;
      }

      const media = new Media(payload);
      await media.save();
      createdCount += 1;
      console.log(`[reconcile] created mediaId=${String(media._id)} gridFsId=${String(file._id)} originalName=${originalName}`);
    } catch (error) {
      failedCount += 1;
      console.error(`[reconcile] failed gridFsId=${String(file._id)} originalName=${originalName} error=${error.message}`);
    }
  }

  console.log(`[reconcile] done created=${createdCount} skipped=${skippedCount} failed=${failedCount} processed=${filesToProcess.length}`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[reconcile] fatal:", error.message);
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
    process.exit(1);
  });