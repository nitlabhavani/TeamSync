import { useEffect, useRef } from "react";

/**
 * High-performance 60fps Student Workspace Background
 * Inspired by Vanta.js Net, Three.js constellations, and ReactBits micro-particles.
 */
const StudentVantaBackground = ({ className = "" }) => {
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

    const mouse = { x: -1000, y: -1000, radius: 140 };

    const handleMouseMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    // Particle nodes configuration
    const count = Math.min(Math.floor((width * height) / 18000), 55);
    const particles = [];
    const colors = [
      { r: 99, g: 102, b: 241 }, // Indigo/Brand
      { r: 168, g: 85, b: 247 }, // Purple
      { r: 56, g: 189, b: 248 }, // Sky/Cyan
      { r: 16, g: 185, b: 129 }, // Mint
    ];

    for (let i = 0; i < count; i++) {
      const col = colors[i % colors.length];
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 2 + 1.2,
        baseRadius: Math.random() * 2 + 1.2,
        r: col.r,
        g: col.g,
        b: col.b,
        alpha: Math.random() * 0.4 + 0.3,
        pulse: Math.random() * Math.PI,
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw and connect particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Move
        p.x += p.vx;
        p.y += p.vy;

        // Bounce at boundaries
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // Subtle mouse repulsion
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mouse.radius) {
          const force = (1 - dist / mouse.radius) * 1.5;
          p.x -= (dx / (dist || 1)) * force;
          p.y -= (dy / (dist || 1)) * force;
        }

        // Pulse
        p.pulse += 0.02;
        const currentAlpha = p.alpha + Math.sin(p.pulse) * 0.15;

        // Draw particle node
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${Math.max(0.1, currentAlpha)})`;
        ctx.shadowColor = `rgba(${p.r}, ${p.g}, ${p.b}, 0.6)`;
        ctx.shadowBlur = 8;
        ctx.fill();

        // Connect to neighbors
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const cdx = p.x - p2.x;
          const cdy = p.y - p2.y;
          const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

          if (cdist < 130) {
            const lineAlpha = (1 - cdist / 130) * 0.22;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.shadowBlur = 0;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <div
      className={`pointer-events-none fixed inset-0 overflow-hidden z-0 ${className}`}
      aria-hidden="true"
    >
      {/* Dynamic Aurora glow blobs */}
      <div className="absolute -top-[20%] left-[10%] w-[600px] h-[600px] rounded-full bg-brand/12 blur-[130px] animate-pulse pointer-events-none" />
      <div className="absolute top-[40%] -right-[15%] w-[550px] h-[550px] rounded-full bg-purple-600/10 blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-[20%] left-[30%] w-[500px] h-[500px] rounded-full bg-mint/10 blur-[130px] pointer-events-none" />

      {/* Cyber Grid Texture */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      {/* 60FPS Canvas Animation */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-60 dark:opacity-75" />
    </div>
  );
};

export default StudentVantaBackground;
