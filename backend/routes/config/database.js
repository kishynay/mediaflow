const mongoose = require("mongoose");

function extractDbNameFromUri(mongoUri) {
  if (!mongoUri) return null;

  try {
    const parsed = new URL(mongoUri);
    const pathName = (parsed.pathname || "").replace(/^\/+/, "");
    return pathName || null;
  } catch (_) {
    return null;
  }
}

function sanitizeMongoUri(mongoUri) {
  if (!mongoUri) return "missing";

  try {
    const parsed = new URL(mongoUri);

    if (parsed.username) {
      parsed.username = "***";
    }

    if (parsed.password) {
      parsed.password = "***";
    }

    return parsed.toString();
  } catch (_) {
    return mongoUri.replace(/\/\/([^/@]+)@/, "//***:***@");
  }
}

function extractHostFromUri(mongoUri) {
  if (!mongoUri) return "unknown";

  try {
    const parsed = new URL(mongoUri);
    return parsed.host || "unknown";
  } catch (_) {
    const match = mongoUri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)/i);
    return match ? match[1] : "unknown";
  }
}

async function connectDB() {
  try {
    const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/mediaflow";
    const uriDbName = extractDbNameFromUri(mongoURI);
    const configuredDbName = process.env.MONGODB_DB_NAME || null;
    const dbName = configuredDbName || uriDbName || "mediaflow";
    const bucketName = process.env.GRIDFS_BUCKET_NAME || "uploads";
    const envName = process.env.NODE_ENV || "development";
    const host = extractHostFromUri(mongoURI);
    const sanitizedUri = sanitizeMongoUri(mongoURI);

    console.log("[mongo] connecting", {
      env: envName,
      host,
      db: dbName,
      uriDbName: uriDbName || null,
      effectiveDbName: dbName,
      bucketName,
      sanitizedUri,
    });

    if (configuredDbName && uriDbName && configuredDbName !== uriDbName) {
      console.warn("[mongo] database name override detected", {
        env: envName,
        host,
        db: configuredDbName,
        uriDbName,
        effectiveDbName: configuredDbName,
        bucketName,
        sanitizedUri,
      });
    }

    await mongoose.connect(mongoURI, { dbName });

    const activeDbName =
      mongoose.connection?.db?.databaseName ||
      mongoose.connection?.name ||
      dbName;
    const activeHost = mongoose.connection?.host || host;

    console.log("[mongo] connected", {
      env: envName,
      host: activeHost,
      db: activeDbName,
      uriDbName: uriDbName || null,
      effectiveDbName: activeDbName,
      bucketName,
      sanitizedUri,
    });
  } catch (error) {
    const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/mediaflow";
    const uriDbName = extractDbNameFromUri(mongoURI);
    const configuredDbName = process.env.MONGODB_DB_NAME || null;
    const dbName = configuredDbName || uriDbName || "mediaflow";
    const bucketName = process.env.GRIDFS_BUCKET_NAME || "uploads";
    const envName = process.env.NODE_ENV || "development";
    const host = extractHostFromUri(mongoURI);
    const sanitizedUri = sanitizeMongoUri(mongoURI);

    console.error("[mongo] connection error", {
      env: envName,
      host,
      db: dbName,
      uriDbName: uriDbName || null,
      effectiveDbName: dbName,
      bucketName,
      sanitizedUri,
      message: error.message,
    });
    process.exit(1);
  }
}

module.exports = connectDB;