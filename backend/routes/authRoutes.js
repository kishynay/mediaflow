const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "change-me";
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || "3h";

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const token = jwt.sign(
      { username, iat: Math.floor(Date.now() / 1000) },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    return res.status(200).json({ token, expiresIn: TOKEN_EXPIRY });
  } catch (error) {
    return res.status(500).json({ error: "Authentication failed", details: error.message });
  }
});

module.exports = router;
