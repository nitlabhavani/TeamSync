const jwt = require("jsonwebtoken");

const signAccessToken = (user) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

const signRefreshToken = (user) =>
  jwt.sign({ sub: String(user._id) }, process.env.REFRESH_TOKEN_SECRET || "dev-refresh", {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "30d",
  });

const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET || "dev-secret");

const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || "dev-refresh");

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
