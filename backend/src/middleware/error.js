const ApiError = require("../utils/apiError");

const notFound = (req, res, next) =>
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let details = err.details;

  if (err.name === "ValidationError") {
    status = 400;
    details = Object.values(err.errors).map((e) => e.message);
    message = details.length ? details.join("; ") : "Validation failed";
  }
  if (err.name === "CastError") {
    status = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }
  if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for ${Object.keys(err.keyValue).join(", ")}`;
  }
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    status = 401;
    message = "Invalid or expired token";
  }
  if (err.name === "MulterError") {
    status = 400;
    if (err.code === "LIMIT_FILE_SIZE") {
      // PRIVATE VOICE MESSAGES use a separate (smaller) MAX_VOICE_MB limit
      // via a differently-named multer field ("audio") than ordinary file
      // attachments ("file"/"files", MAX_UPLOAD_MB) — report whichever
      // limit actually applied instead of always quoting MAX_UPLOAD_MB.
      const limitMb = err.field === "audio" ? process.env.MAX_VOICE_MB || 15 : process.env.MAX_UPLOAD_MB || 25;
      message = `File exceeds the maximum upload size of ${limitMb}MB`;
    } else {
      message = `Upload failed: ${err.message}`;
    }
  }

  if (status >= 500) console.error(err);

  res.status(status).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(process.env.NODE_ENV === "development" && status >= 500 ? { stack: err.stack } : {}),
  });
};

module.exports = { notFound, errorHandler };
