import { useEffect, useRef, useState } from "react";

/**
 * Six-box OTP entry with paste, arrow-key and backspace support.
 */
const OtpInput = ({ value = "", onChange, disabled, autoFocus = true }) => {
  const digits = value.padEnd(6, " ").slice(0, 6).split("").map((d) => (d === " " ? "" : d));
  const refs = useRef([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const commit = (next) => onChange(next.join("").trim());

  const handleChange = (idx, raw) => {
    const char = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[idx] = char;
    commit(next);
    if (char && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      const next = [...digits];
      next[idx - 1] = "";
      commit(next);
      refs.current[idx - 1]?.focus();
      e.preventDefault();
    }
    if (e.key === "ArrowLeft" && idx > 0) refs.current[idx - 1]?.focus();
    if (e.key === "ArrowRight" && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handlePaste = (e) => {
    const pasted = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex gap-2.5" onPaste={handlePaste}>
      {digits.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => (refs.current[idx] = el)}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`Digit ${idx + 1}`}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          className={`w-12 h-14 text-center text-xl font-display font-semibold rounded-xl outline-none
                     border bg-cloud/60 transition-all duration-150
                     focus:bg-paper focus:border-brand focus:ring-4 focus:ring-brand/15 focus:shadow-pop
                     disabled:opacity-60 ${digit ? "border-brand/60 bg-paper" : "border-slate-line"}`}
        />
      ))}
    </div>
  );
};

export default OtpInput;
