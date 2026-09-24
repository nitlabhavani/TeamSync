const net = require("net");

/**
 * Validates and sanitizes a meeting join URL.
 * - Accepts null / undefined / empty string (returns null).
 * - Requires strict https:// protocol.
 * - Rejects javascript:, data:, file:, and any non-https schemes.
 * - Rejects HTML / script injection characters.
 * - Rejects localhost, loopback, private, or link-local IP addresses.
 * - Requires a valid public domain name.
 *
 * @param {string} rawUrl
 * @returns {string|null} Sanitized HTTPS URL or throws an Error
 */
function validateMeetingLink(rawUrl) {
  if (rawUrl === null || rawUrl === undefined || rawUrl === "") {
    return null;
  }

  const str = String(rawUrl).trim();
  if (!str) return null;

  const lower = str.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    throw new Error("Unsafe URL scheme detected");
  }

  // Reject HTML tags, script injection patterns, or control chars
  if (/[<>\r\n\t\0]/.test(str)) {
    throw new Error("Meeting link contains invalid characters or HTML");
  }

  if (!lower.startsWith("https://")) {
    throw new Error("Meeting link must be a secure HTTPS URL (starting with https://)");
  }

  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Meeting link must use the https: protocol");
  }

  const hostname = parsed.hostname.toLowerCase();

  // Disallow localhost or local domains
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Localhost and local network domains are not permitted for meeting links");
  }

  // Check if hostname is an IP address
  const isIp = net.isIP(hostname);
  if (isIp) {
    throw new Error("IP addresses are not permitted for meeting links. Please provide a valid domain name");
  }

  // Check hostname format (must have at least one dot and a valid TLD)
  if (!hostname.includes(".") || hostname.startsWith(".") || hostname.endsWith(".")) {
    throw new Error("Meeting link must have a valid domain name");
  }

  const parts = hostname.split(".");
  const tld = parts[parts.length - 1];
  if (tld.length < 2 || !/^[a-z]+$/.test(tld)) {
    throw new Error("Meeting link contains an invalid top-level domain");
  }

  return parsed.href;
}

module.exports = {
  validateMeetingLink,
};
