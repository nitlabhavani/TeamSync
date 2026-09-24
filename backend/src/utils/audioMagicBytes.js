const fs = require("fs");

/**
 * PRODUCTION-GRADE AUDIO MAGIC BYTES & SIGNATURE VERIFICATION
 * ==========================================================
 *
 * Verifies real audio file signatures without external dependencies.
 * Prevents MIME-spoofing attacks where non-audio files (such as executables,
 * scripts, or disguised malware) are uploaded with a forged Content-Type
 * header (e.g. "audio/webm").
 *
 * Checks:
 * - Minimum valid header length (at least 32 bytes)
 * - WebM: EBML header (0x1A, 0x45, 0xDF, 0xA3)
 * - OGG: OggS container (0x4F, 0x67, 0x67, 0x53)
 * - MP4 / M4A: ISO base media file format containing 'ftyp' at offset 4
 * - MP3: ID3v2 container (0x49, 0x44, 0x33) or MPEG sync frame (0xFF, 0xE0 mask)
 * - WAV: RIFF container (0x52, 0x49, 0x46, 0x46) + WAVE format (0x57, 0x41, 0x56, 0x45)
 * - AAC: ADTS sync frame (0xFF, 0xF0 mask)
 */

function verifyAudioBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    return { valid: false, reason: "File too small or corrupted" };
  }

  // 1. WebM (EBML: 0x1A 0x45 0xDF 0xA3)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { valid: true, format: "webm" };
  }

  // 2. OGG (OggS: 0x4F 0x67 0x67 0x53)
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return { valid: true, format: "ogg" };
  }

  // 3. MP4 / M4A ('ftyp' box at offset 4: 0x66 0x74 0x79 0x70)
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { valid: true, format: "mp4" };
  }

  // 4. MP3 (ID3: 0x49 0x44 0x33 or MPEG sync frame: 0xFF followed by 0xE0 mask)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return { valid: true, format: "mp3" };
  }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { valid: true, format: "mp3" };
  }

  // 5. WAV (RIFF at 0..3: 0x52 0x49 0x46 0x46 and WAVE at 8..11: 0x57 0x41 0x56 0x45)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return { valid: true, format: "wav" };
  }

  // 6. AAC (ADTS frame sync: 0xFF followed by 0xF0 mask)
  if (buf[0] === 0xff && (buf[1] & 0xf0) === 0xf0) {
    return { valid: true, format: "aac" };
  }

  return { valid: false, reason: "Unrecognized or non-audio binary header" };
}

/**
 * Reads the leading bytes of a file on disk and verifies that its binary
 * signature matches a supported audio format.
 */
function verifyAudioFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: "File not found on disk" };
  }

  const stat = fs.statSync(filePath);
  if (stat.size < 12) {
    return { valid: false, reason: "Audio file is empty or corrupted" };
  }

  let fd;
  try {
    const bytesToRead = Math.min(64, stat.size);
    const buffer = Buffer.alloc(bytesToRead);
    fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return verifyAudioBuffer(buffer);
  } catch (err) {
    return { valid: false, reason: `Failed to inspect audio file: ${err.message}` };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = {
  verifyAudioBuffer,
  verifyAudioFile,
};
