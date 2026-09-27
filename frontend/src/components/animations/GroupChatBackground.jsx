import { useEffect, useRef } from "react";

/**
 * 60fps Dynamic Group Chat Background
 * Collaborative multi-node team pulse with flowing data packets & aurora glow.
 */
const GroupChatBackground = ({ className = "" }) => {
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

    // Group member node configuration
    const nodeCount = 14;
    const nodes = [];
    const colors = [
      { r: 99, g: 102, b: 241 }, // Indigo
      { r: 168, g: 85, b: 247 }, // Purple
      { r: 16, g: 185, b: 129 }, // Mint
      { r: 245, g: 158, b: 11 }, // Amber
      { r: 6, g: 182, b: 212 },  // Cyan
    ];

    for (let i = 0; i < nodeCount; i++) {
      const c = colors[i % colors.length];
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        radius: Math.random() * 2.5 + 2,
        r: c.r,
        g: c.g,
        b: c.b,
        alpha: Math.random() * 0.4 + 0.3,
        pulse: Math.random() * Math.PI,
      });
    }

    // Flowing message data packets
    const packets = [
      { from: 0, to: 1, progress: 0, speed: 0.008 },
      { from: 2, to: 3, progress: 0.5, speed: 0.007 },
      { from: 4, to: 5, progress: 0.2, speed: 0.009 },
      { from: 1, to: 6, progress: 0.8, speed: 0.006 },
    ];

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Update and draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;

        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;

        n.pulse += 0.02;
        const currentAlpha = n.alpha + Math.sin(n.pulse) * 0.15;

        // Draw node
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${n.r}, ${n.g}, ${n.b}, ${Math.max(0.1, currentAlpha)})`;
        ctx.shadowColor = `rgba(${n.r}, ${n.g}, ${n.b}, 0.8)`;
        ctx.shadowBlur = 10;
        ctx.fill();

        // Connect team threads
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n.x - n2.x;
          const dy = n.y - n2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 180) {
            const lineAlpha = (1 - dist / 180) * 0.15;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.strokeStyle = `rgba(${n.r}, ${n.g}, ${n.b}, ${lineAlpha})`;
            ctx.lineWidth = 0.9;
            ctx.shadowBlur = 0;
            ctx.stroke();
          }
        }
      }

      // Draw active packet flows
      packets.forEach((pkt) => {
        pkt.progress += pkt.speed;
        if (pkt.progress >= 1) {
          pkt.progress = 0;
          pkt.from = Math.floor(Math.random() * nodes.length);
          pkt.to = (pkt.from + 1 + Math.floor(Math.random() * (nodes.length - 1))) % nodes.length;
        }

        const n1 = nodes[pkt.from];
        const n2 = nodes[pkt.to];
        if (n1 && n2) {
          const px = n1.x + (n2.x - n1.x) * pkt.progress;
          const py = n1.y + (n2.y - n1.y) * pkt.progress;

          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, 0.85)`;
          ctx.shadowColor = `rgba(${n1.r}, ${n1.g}, ${n1.b}, 1)`;
          ctx.shadowBlur = 8;
          ctx.fill();
        }
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
      className={`pointer-events-none absolute inset-0 overflow-hidden z-0 ${className}`}
      aria-hidden="true"
    >
      {/* Team Multi-Aurora Glow Blobs */}
      <div className="absolute top-[15%] left-[10%] w-[450px] h-[450px] rounded-full bg-brand/10 blur-[130px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-[20%] right-[10%] w-[400px] h-[400px] rounded-full bg-mint/10 blur-[120px] pointer-events-none" />
      <div className="absolute top-[50%] right-[30%] w-[350px] h-[350px] rounded-full bg-purple-600/8 blur-[120px] pointer-events-none" />

      {/* Hexagonal / Chat Matrix Dots */}
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.055] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
      />

      {/* 60FPS Canvas Animation */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-65 dark:opacity-80" />
    </div>
  );
};

export default GroupChatBackground;
