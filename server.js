const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const mime = require("mime-types");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx < 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, "media"));
const EXTERNAL_MEDIA_DIR = process.env.EXTERNAL_MEDIA_DIR
  ? path.resolve(process.env.EXTERNAL_MEDIA_DIR)
  : null;
const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "change-me";

// Ensure media directory exists.
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

if (!process.env.AUTH_PASSWORD) {
  console.warn("AUTH_PASSWORD is not set. Using default password 'change-me'.");
}

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

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.use(authMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, MEDIA_DIR),
  filename: (_, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^\w.\-() ]/g, "_").trim();
    cb(null, `${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage });

const MEDIA_SOURCES = {
  local: MEDIA_DIR,
  ...(EXTERNAL_MEDIA_DIR ? { external: EXTERNAL_MEDIA_DIR } : {})
};

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

async function readMediaFromDir(source, dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const stats = await fs.promises.stat(dirPath).catch(() => null);
  if (!stats || !stats.isDirectory()) return [];

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  return Promise.all(
    files.map(async (fileName) => {
      const fullPath = path.join(dirPath, fileName);
      const stat = await fs.promises.stat(fullPath);
      const { type, contentType } = detectType(fileName);
      return {
        id: `${source}:${fileName}`,
        name: fileName.replace(/^\d+-/, ""),
        rawName: fileName,
        source,
        sizeBytes: stat.size,
        size: humanSize(stat.size),
        type,
        contentType,
        modifiedAt: stat.mtime.toISOString(),
        _mtimeMs: stat.mtimeMs,
        url: `/media/${source}/${encodeURIComponent(fileName)}`
      };
    })
  );
}

function buildSafeFilePath(dirPath, fileName) {
  const safeFileName = path.basename(fileName);
  const filePath = path.join(dirPath, safeFileName);
  if (!filePath.startsWith(dirPath)) return null;
  return filePath;
}

async function readMedia() {
  const reads = [readMediaFromDir("local", MEDIA_SOURCES.local)];
  if (MEDIA_SOURCES.external) {
    reads.push(readMediaFromDir("external", MEDIA_SOURCES.external));
  }

  const allItems = await Promise.all(reads);
  const list = allItems.flat();
  list.sort((a, b) => b._mtimeMs - a._mtimeMs);
  return list.map(({ _mtimeMs, ...rest }) => rest);
}

function streamMediaFile(fileName, filePath, req, res) {
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return res.status(404).json({ error: "File not found" });
  const fileSize = stat.size;
  const { contentType } = detectType(fileName);
  const isStreamable = contentType.startsWith("video/") || contentType.startsWith("audio/");

  if (isStreamable && req.headers.range) {
    const parts = req.headers.range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1); // 1MB chunks
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });

    fs.createReadStream(filePath).pipe(res);
  }
}

function resolveSourceFile(source, fileName) {
  const sourceDir = MEDIA_SOURCES[source];
  if (!sourceDir) return { error: "Forbidden", status: 403, filePath: null };
  const filePath = buildSafeFilePath(sourceDir, fileName);
  if (!filePath || !fs.existsSync(filePath)) {
    return { error: "File not found", status: 404, filePath: null };
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { error: "File not found", status: 404, filePath: null };
  return { filePath, sourceDir, stat };
}

// Serve media files at /media/<source>/<filename> with range support for streaming.
app.get("/media/:source/:filename", (req, res) => {
  const source = req.params.source;
  const fileName = req.params.filename;
  const sourceDir = MEDIA_SOURCES[source];

  if (!sourceDir) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const filePath = buildSafeFilePath(sourceDir, fileName);
  return streamMediaFile(fileName, filePath, req, res);
});

// Backward compatibility for old URLs: /media/<filename> checks local first, then external.
app.get("/media/:filename", (req, res) => {
  const fileName = req.params.filename;
  const localPath = buildSafeFilePath(MEDIA_SOURCES.local, fileName);
  if (localPath && fs.existsSync(localPath)) return streamMediaFile(fileName, localPath, req, res);

  const externalPath = MEDIA_SOURCES.external
    ? buildSafeFilePath(MEDIA_SOURCES.external, fileName)
    : null;
  return streamMediaFile(fileName, externalPath, req, res);
});

app.get("/api/media/:source/:filename/download", (req, res) => {
  const { source, filename } = req.params;
  const resolved = resolveSourceFile(source, filename);
  if (!resolved.filePath) {
    return res.status(resolved.status).json({ error: resolved.error });
  }
  return res.download(resolved.filePath, path.basename(filename));
});

app.delete("/api/media/:source/:filename", async (req, res) => {
  const { source, filename } = req.params;
  const resolved = resolveSourceFile(source, filename);
  if (!resolved.filePath) {
    return res.status(resolved.status).json({ error: resolved.error });
  }

  try {
    await fs.promises.unlink(resolved.filePath);
    return res.json({ message: "Deleted", source, name: path.basename(filename) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete file" });
  }
});

// Optional upload endpoint (compatible with existing frontend).
app.post("/api/upload", upload.single("media"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const { type, contentType } = detectType(req.file.filename);
  return res.status(201).json({
    message: "Upload successful.",
    item: {
      id: req.file.filename,
      name: req.file.filename.replace(/^\d+-/, ""),
      size: req.file.size,
      type,
      contentType,
      url: `/media/${encodeURIComponent(req.file.filename)}`
    }
  });
});

// Required endpoint: /media-list
app.get("/media-list", async (_, res) => {
  try {
    const items = await readMedia();
    const response = items.map((item) => ({
      name: item.rawName,
      size: item.size,
      type: item.type,
      url: item.url
    }));
    return res.json(response);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load media from server" });
  }
});

// Backward-compatible endpoint used by current UI.
app.get("/api/media", async (_, res) => {
  try {
    const items = await readMedia();
    return res.json({
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        size: item.sizeBytes,
        modifiedAt: item.modifiedAt,
        contentType: item.contentType,
        kind: item.type,
        source: item.source,
        url: item.url
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load media from server" });
  }
});

// Avoid "Cannot GET /media" confusion.
app.get("/media", async (_, res) => {
  try {
    const items = await readMedia();
    return res.json({
      message: "Media directory root. Use /media/<filename> for files.",
      count: items.length,
      sample: items.slice(0, 10).map((x) => x.url)
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load media from server" });
  }
});

// 404 fallback for missing API/media routes.
app.use((req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/media")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`Media server running at http://localhost:${PORT}`);
});
