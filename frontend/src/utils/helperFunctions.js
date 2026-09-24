export const getInitials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export const classNames = (...values) => values.filter(Boolean).join(" ");

export const truncate = (text = "", max = 60) =>
  text.length > max ? `${text.slice(0, max).trim()}…` : text;

export const formatFileSize = (bytes) => {
  if (bytes === 0 || !bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

/**
 * PRIVATE VOICE MESSAGES — formats a real duration in seconds as m:ss
 * (e.g. 8 -> "0:08", 72 -> "1:12"). Used for both the live recording timer
 * and recorded/played-back voice message duration — never a fake/placeholder
 * value, always the actual MediaRecorder-measured or <audio> duration.
 */
export const formatDuration = (totalSeconds) => {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
};

export const stringToHslColor = (str = "", s = 60, l = 55) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = hash % 360;
  return `hsl(${h}, ${s}%, ${l}%)`;
};

export const scoreToLevel = (score) => {
  if (score >= 75) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
};
