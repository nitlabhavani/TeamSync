export const isValidEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

export const isValidPhone = (value) => /^[0-9]{10}$/.test(String(value || "").replace(/\D/g, ""));

export const isStrongPassword = (value) => typeof value === "string" && value.length >= 8;

export const passwordStrength = (value) => {
  if (!value) return { score: 0, label: "" };
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] };
};

export const isRequired = (value) =>
  value !== undefined && value !== null && String(value).trim().length > 0;

export const isValidOtp = (value) => /^[0-9]{6}$/.test(String(value || "").trim());
