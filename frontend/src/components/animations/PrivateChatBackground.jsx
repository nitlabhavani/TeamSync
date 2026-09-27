import { useEffect, useRef } from "react";

/**
 * 60fps Encrypted 1-on-1 Private Chat Background
 * Dual interconnected focal orbital nodes with harmonic resonance sine waves & privacy shield rings.
 */
const PrivateChatBackground = ({ className = "" }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth || window.innerWidth;
      height = canvas.height = canvas.parentElement.clientHeight || window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    let angle = 0;
    let waveOffset = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      angle += 0.012;
      waveOffset += 0.02;

      const p1 = { x: width * 0.25, y: height * 0.4 };
      const p2 = { x: width * 0.75, y: height * 0.6 };

      // Draw Privacy Shield Concentric Orbitals around Peer 1
      for (let r = 30; r <= 90; r += 30) {
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, r + Math.sin(angle * 2) * 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(99, 102, 241, 0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw Privacy Shield Concentric Orbitals around Peer 2
      for (let r = 30; r <= 90; r += 30) {
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, r + Math.cos(angle * 2) * 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw Encrypted Harmonic Sine Resonance connecting Peer 1 to Peer 2
      ctx.beginPath();
      const waveCount = 50;
      for (let i = 0; i <= waveCount; i++) {
        const t = i / waveCount;
        const x = p1.x + (p2.x - p1.x) * t;
        const baseY = p1.y + (p2.y - p1.y) * t;
        const offset = Math.sin(t * Math.PI * 3 + waveOffset) * (18 * Math.sin(t * Math.PI));
        const y = baseY + offset;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(99, 102, 241, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "rgba(99, 102, 241, 0.5)";
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw Peer 1 Focal Core
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#6366F1";
      ctx.shadowColor = "#6366F1";
      ctx.shadowBlur = 10;
      ctx.fill();

      // Draw Peer 2 Focal Core
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#06B6D4";
      ctx.shadowColor = "#06B6D4";
      ctx.shadowBlur = 10;
      ctx.fill();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden z-0 ${className}`}
      aria-hidden="true"
    >
      {/* 1-on-1 Dual Shield Glow Blobs */}
      <div className="absolute top-[25%] left-[20%] w-[400px] h-[400px] rounded-full bg-indigo-500/10 blur-[130px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-[25%] right-[20%] w-[400px] h-[400px] rounded-full bg-cyan-500/10 blur-[130px] pointer-events-none" />

      {/* Subtle Privacy Mesh Texture */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: "36px 36px",
        }}
      />

      {/* 60FPS Canvas Animation */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-65 dark:opacity-80" />
    </div>
  );
};

export default PrivateChatBackground;
