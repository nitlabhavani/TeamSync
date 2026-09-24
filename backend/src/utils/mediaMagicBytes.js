const fs = require("fs");

/**
 * PRODUCTION-GRADE MEDIA MAGIC BYTES & SIGNATURE VERIFICATION
 * ===========================================================
 *
 * Verifies real image and video file signatures directly from disk buffers
 * without external dependencies. Prevents MIME-spoofing attacks where non-media
 * files (executables, disguised scripts, HTML/SVG XSS vectors) are uploaded with
 * forged Content-Type headers.
 *
 * Supported Image Formats:
 *  - PNG:  0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
 *  - JPEG: 0xFF 0xD8 0xFF
 *  - GIF:  "GIF87a" (0x47 0x49 0x46 0x38 0x37 0x61) or "GIF89a" (0x47 0x49 0x46 0x38 0x39 0x61)
 *  - WebP: "RIFF" at 0..3 (0x52 0x49 0x46 0x46) + "WEBP" at 8..11 (0x57 0x45 0x42 0x50)
 *
 * Supported Video Formats:
 *  - MP4 / QuickTime (MOV): 'ftyp' at offset 4..7 (0x66 0x74 0x79 0x70) or 'moov' (0x6D 0x6F 0x6F 0x76)
 *  - WebM: EBML header (0x1A 0x45 0xDF 0xA3)
 *  - OGG:  OggS container (0x4F 0x67 0x67 0x53)
 */

function verifyMediaBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    return { valid: false, reason: "File too small or corrupted" };
  }

  // --- IMAGES ---

  // 1. PNG (8 bytes: 89 50 4E 47 0D 0A 1A 0A)
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { valid: true, type: "image", format: "png" };
  }

  // 2. JPEG (FF D8 FF)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { valid: true, type: "image", format: "jpeg" };
  }

  // 3. GIF ("GIF87a" or "GIF89a")
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return { valid: true, type: "image", format: "gif" };
  }

  // 4. WebP ("RIFF" at 0..3 and "WEBP" at 8..11)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { valid: true, type: "image", format: "webp" };
  }

  // --- VIDEOS ---

  // 5. MP4 / MOV / M4V: 'ftyp' at offset 4..7 (0x66 0x74 0x79 0x70) or 'moov' (0x6D 0x6F 0x6F 0x76)
  if (
    buf.length >= 12 &&
    ((buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) ||
      (buf[4] === 0x6d && buf[5] === 0x6f && buf[6] === 0x6f && buf[7] === 0x76))
  ) {
    return { valid: true, type: "video", format: "mp4" };
  }

  // 6. WebM (EBML: 0x1A 0x45 0xDF 0xA3)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { valid: true, type: "video", format: "webm" };
  }

  // 7. OGG video/audio (OggS: 0x4F 0x67 0x67 0x53)
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return { valid: true, type: "video", format: "ogg" };
  }

  return { valid: false, reason: "Unrecognized or unsupported binary media header" };
}

/**
 * Inspects the binary header of a file on disk and verifies that its signature
 * matches a supported photo or video format.
 */
function verifyMediaFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: "File not found on disk" };
  }

  const stat = fs.statSync(filePath);
  if (stat.size < 12) {
    return { valid: false, reason: "Media file is too small or corrupted" };
  }

  let fd;
  try {
    const bytesToRead = Math.min(64, stat.size);
    const buffer = Buffer.alloc(bytesToRead);
    fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return verifyMediaBuffer(buffer);
  } catch (err) {
    return { valid: false, reason: `Failed to inspect media file: ${err.message}` };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore close errors */
      }
    }
  }
}

/**
 * Verifies that a binary buffer begins with valid ZIP archive magic bytes:
 * - 0x50 0x4B 0x03 0x04 (standard local file header)
 * - 0x50 0x4B 0x05 0x06 (empty archive)
 * - 0x50 0x4B 0x07 0x08 (spanned archive)
 */
function verifyZipBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) {
    return { valid: false, reason: "File too small or corrupted" };
  }
  if (
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    ((buf[2] === 0x03 && buf[3] === 0x04) ||
      (buf[2] === 0x05 && buf[3] === 0x06) ||
      (buf[2] === 0x07 && buf[3] === 0x08))
  ) {
    return { valid: true, type: "zip", format: "zip" };
  }
  return { valid: false, reason: "Invalid ZIP file header: missing PK signature" };
}

function verifyZipFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: "File not found on disk" };
  }
  const stat = fs.statSync(filePath);
  if (stat.size < 4) {
    return { valid: false, reason: "ZIP file is too small or corrupted" };
  }
  let fd;
  try {
    const buffer = Buffer.alloc(4);
    fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 4, 0);
    return verifyZipBuffer(buffer);
  } catch (err) {
    return { valid: false, reason: `Failed to inspect ZIP file: ${err.message}` };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore close errors */
      }
    }
  }
}

module.exports = {
  verifyMediaBuffer,
  verifyMediaFile,
  verifyZipBuffer,
  verifyZipFile,
};
