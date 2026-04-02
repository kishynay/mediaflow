require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");

const connectDB = require("./config/database");
const Media = require("./models/Media");
const authMiddleware = require("./middleware/auth");
const authRoutes = require("./routes/authRoutes");
const mediaModule = require("./routes/mediaRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const defaultAllowedOrigins = ["https://kishynay-mediaflow.vercel.app"];
const mergedAllowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...allowedOrigins]));
const projectPreviewOriginPattern = /^https:\/\/kishynay-mediaflow(?:-[a-z0-9-]+)?\.vercel\.app$/i;

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      return callback(null, true);
    }

    if (mergedAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow Vercel preview URLs for this project (e.g. -git-main-<hash>.vercel.app)
    if (projectPreviewOriginPattern.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Range", "X-Total-Count", "Content-Disposition"],
  credentials: true,
  optionsSuccessStatus: 204,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SERVE_FRONTEND = process.env.SERVE_FRONTEND !== "false";
if (SERVE_FRONTEND) {
  app.use(express.static(path.join(__dirname, "frontend")));
}

// Route mounting
app.use("/api/auth", authRoutes);
app.use("/api/media", mediaModule.router);

// Backward compatibility for old frontend upload endpoint: POST /api/upload
app.post("/api/upload", authMiddleware, mediaModule.uploadMiddleware, mediaModule.uploadHandler);

app.get("/health", async (req, res) => {
  try {
    await require("mongoose").connection.db.admin().ping();
    return res.status(200).json({
      ok: true,
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      database: "disconnected",
      error: error.message
    });
  }
});

// Backward compatibility endpoint
app.get("/media-list", authMiddleware, async (req, res) => {
  try {
    const mediaRes = await Media.find().sort({ uploadDate: -1 });
    const response = mediaRes.map((item) => ({
      name: item.filename,
      size: item.size,
      type: item.metadata?.type,
      url: `/api/media/${item._id}/stream`
    }));
    return res.json(response);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load media", details: error.message });
  }
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.status(404).send("Not found");
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Internal Server Error" });
});

async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Media server running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;