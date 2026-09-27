import { useEffect, useRef } from "react";

/**
 * High-performance 60fps Guide & Faculty Supervision Background
 * Inspired by Vanta.js Topology / Globe, Three.js rotating radar beams, and Shadcn analytics command centers.
 */
const GuideTopologyBackground = ({ className = "" }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    let angle = 0;
    let waveOffset = 0;

    // Fixed supervision radar nodes
    const nodes = [
      { xRel: 0.85, yRel: 0.25, r: 16, g: 185, b: 129, label: "AI Engine Active" },
      { xRel: 0.15, yRel: 0.7, r: 99, g: 102, b: 241, label: "Sockets Sync" },
      { xRel: 0.75, yRel: 0.8, r: 20, g: 184, b: 166, label: "Archive Bundle" },
      { xRel: 0.35, yRel: 0.2, r: 168, g: 85, b: 247, label: "Verification Core" },
    ];

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      angle += 0.008;
      waveOffset += 0.015;

      // Draw subtle orbital radar ring in the top right
      const radarCenterX = width * 0.85;
      const radarCenterY = height * 0.25;
      const maxRadarRadius = Math.min(width, height) * 0.45;

      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(radarCenterX, radarCenterY, (maxRadarRadius * i) / 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(16, 185, 129, 0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Rotating radar beam
      ctx.save();
      ctx.translate(radarCenterX, radarCenterY);
      ctx.rotate(angle);

      const grad = ctx.createLinearGradient(0, 0, maxRadarRadius, 0);
      grad.addColorStop(0, "rgba(16, 185, 129, 0.22)");
      grad.addColorStop(1, "transparent");

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxRadarRadius, 0, Math.PI / 6);
      ctx.closePath();
      ctx.fillStyle = "rgba(16, 185, 129, 0.04)";
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(maxRadarRadius, 0);
      ctx.strokeStyle = "rgba(16, 185, 129, 0.18)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Topographic sine waves at bottom
      const waveCount = 3;
      for (let w = 0; w < waveCount; w++) {
        ctx.beginPath();
        const baseH = height * (0.8 + w * 0.06);
        ctx.moveTo(0, baseH);

        for (let x = 0; x <= width; x += 30) {
          const y =
            baseH +
            Math.sin(x * 0.003 + waveOffset + w * 1.5) * 22 +
            Math.cos(x * 0.002 - waveOffset) * 15;
          ctx.lineTo(x, y);
        }

        ctx.strokeStyle = `rgba(20, 184, 166, ${0.06 - w * 0.015})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Draw telemetry pulse nodes
      nodes.forEach((node) => {
        const nx = width * node.xRel;
        const ny = height * node.yRel;

        ctx.beginPath();
        ctx.arc(nx, ny, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${node.r}, ${node.g}, ${node.b}, 0.6)`;
        ctx.shadowColor = `rgba(${node.r}, ${node.g}, ${node.b}, 0.8)`;
        ctx.shadowBlur = 8;
        ctx.fill();

        // Expanding beacon ring
        const ringScale = ((Math.sin(angle * 3 + node.xRel * 10) + 1) / 2) * 16 + 4;
        ctx.beginPath();
        ctx.arc(nx, ny, ringScale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${node.r}, ${node.g}, ${node.b}, ${0.25 - ringScale / 90})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.stroke();
      });

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
      className={`pointer-events-none fixed inset-0 overflow-hidden z-0 ${className}`}
      aria-hidden="true"
    >
      {/* Faculty Command Glow Blobs */}
      <div className="absolute top-[10%] -right-[10%] w-[650px] h-[650px] rounded-full bg-emerald-500/10 blur-[150px] animate-pulse pointer-events-none" />
      <div className="absolute -bottom-[15%] left-[5%] w-[600px] h-[600px] rounded-full bg-teal-600/10 blur-[150px] pointer-events-none" />
      <div className="absolute top-[45%] left-[25%] w-[450px] h-[450px] rounded-full bg-indigo-600/8 blur-[130px] pointer-events-none" />

      {/* Hexagonal / Precision Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
        }}
      />

      {/* 60FPS Canvas Topology & Radar Animation */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-65 dark:opacity-80" />
    </div>
  );
};

export default GuideTopologyBackground;
