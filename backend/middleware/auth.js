const jwt = require("jsonwebtoken");

const AUTH_ENABLED = process.env.AUTH_ENABLED !== "false";
const JWT_SECRET = process.env.JWT_SECRET || "change-me";

function respondUnauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (req.method === "OPTIONS") return next();
  const requestPath = req.path || req.originalUrl || "";
  if (requestPath === "/health" || requestPath.startsWith("/api/auth")) return next();

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return respondUnauthorized(res);
  }

  const token = authHeader.slice(7).trim();
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return respondUnauthorized(res);
    req.auth = payload;
    next();
  });
}

module.exports = authMiddleware;
