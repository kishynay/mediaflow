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

async function connectDB() {
  try {
    const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/mediaflow";
    const uriDbName = extractDbNameFromUri(mongoURI);
    const dbName = process.env.MONGODB_DB_NAME || uriDbName || "mediaflow";

    await mongoose.connect(mongoURI, { dbName });

    const activeDbName = mongoose.connection?.name || "unknown";
    const activeHost = mongoose.connection?.host || "unknown";

    console.log(`[mongo] connected env=${process.env.NODE_ENV || "development"} host=${activeHost} db=${activeDbName}`);
    console.log(`[mongo] config uriDbName=${uriDbName || "none"} effectiveDbName=${dbName}`);
  } catch (error) {
    console.error("[mongo] connection error:", error.message);
    process.exit(1);
  }
}

module.exports = connectDB;
