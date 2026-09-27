import { useEffect, useRef } from "react";

/**
 * High-performance 3D Particle Wave & Interactive Net Background
 * Inspired by Vanta.js Net/Waves + ReactBits Aurora & Three.js wireframes.
 * Zero external heavyweight dependencies; runs at silky 60fps on native Canvas2D.
 */
const VantaNetBackground = ({
  particleCount = 55,
  connectionDistance = 140,
  mouseRadius = 180,
  primaryColor = "99, 102, 241", // Indigo
  accentColor = "16, 185, 129",  // Mint
  secondaryColor = "217, 70, 239", // Fuchsia
  className = "",
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const mouse = {
      x: width / 2,
      y: height / 2,
      targetX: width / 2,
      targetY: height / 2,
      radius: mouseRadius,
      active: false,
    };

    // Initialize floating nodes with 3D depth illusion (z coordinate)
    const particles = [];
    const count = Math.min(particleCount, Math.floor((width * height) / 16000));

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random() * 0.8 + 0.2, // Depth factor
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        radius: Math.random() * 2.2 + 1.2,
        colorType: i % 3 === 0 ? primaryColor : i % 3 === 1 ? secondaryColor : accentColor,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Floating 3D Geometric Polyhedra nodes (inspired by CGTrader/Sketchfab 3D wireframes)
    const shapes = [
      { x: width * 0.15, y: height * 0.25, rot: 0, size: 28, speed: 0.008, type: "octa" },
      { x: width * 0.85, y: height * 0.35, rot: 1, size: 34, speed: -0.006, type: "cube" },
      { x: width * 0.75, y: height * 0.75, rot: 2, size: 24, speed: 0.007, type: "tetra" },
      { x: width * 0.2, y: height * 0.8, rot: 3, size: 30, speed: -0.009, type: "octa" },
    ];

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.targetX = e.clientX - rect.left;
      mouse.targetY = e.clientY - rect.top;
      mouse.active = true;
    };

    const handleMouseLeave = () => {
      mouse.active = false;
    };

    window.addEventListener("resize", handleResize);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    let time = 0;

    const draw3DShape = (shape, t) => {
      ctx.save();
      ctx.translate(shape.x + Math.sin(t * 0.5 + shape.rot) * 15, shape.y + Math.cos(t * 0.4 + shape.rot) * 15);
      ctx.rotate(t * shape.speed * 20);

      ctx.strokeStyle = `rgba(${primaryColor}, 0.22)`;
      ctx.lineWidth = 1;

      const s = shape.size;
      if (shape.type === "octa") {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.7, 0);
        ctx.closePath();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-s * 0.7, 0);
        ctx.lineTo(s * 0.7, 0);
        ctx.stroke();
      } else if (shape.type === "cube") {
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.strokeRect(-s / 4, -s / 4, s, s);
        ctx.beginPath();
        ctx.moveTo(-s / 2, -s / 2);
        ctx.lineTo(-s / 4, -s / 4);
        ctx.moveTo(s / 2, -s / 2);
        ctx.lineTo(s * 0.75, -s / 4);
        ctx.moveTo(s / 2, s / 2);
        ctx.lineTo(s * 0.75, s * 0.75);
        ctx.moveTo(-s / 2, s / 2);
        ctx.lineTo(-s / 4, s * 0.75);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s, s);
        ctx.lineTo(-s, s);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    };

    const render = () => {
      time += 0.015;
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse interpolation
      mouse.x += (mouse.targetX - mouse.x) * 0.08;
      mouse.y += (mouse.targetY - mouse.y) * 0.08;

      // Draw subtle ambient aurora glow
      const auroraGradient = ctx.createRadialGradient(
        width * 0.5 + Math.sin(time * 0.5) * 80,
        height * 0.35 + Math.cos(time * 0.4) * 50,
        20,
        width * 0.5,
        height * 0.4,
        width * 0.6
      );
      auroraGradient.addColorStop(0, `rgba(${primaryColor}, 0.07)`);
      auroraGradient.addColorStop(0.5, `rgba(${secondaryColor}, 0.04)`);
      auroraGradient.addColorStop(1, "transparent");
      ctx.fillStyle = auroraGradient;
      ctx.fillRect(0, 0, width, height);

      // Draw 3D wireframe floating shapes
      shapes.forEach((shape) => draw3DShape(shape, time));

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Ambient movement + wave wobble
        p.x += p.vx * p.z + Math.cos(time + p.phase) * 0.25;
        p.y += p.vy * p.z + Math.sin(time + p.phase) * 0.25;

        // Wrap around boundaries
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        // Interactive mouse repulsion/pull
        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < mouse.radius) {
            const force = (1 - dist / mouse.radius) * 1.5;
            p.x -= (dx / dist) * force * p.z;
            p.y -= (dy / dist) * force * p.z;
          }
        }

        // Draw particle dot with depth scaling
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * p.z, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.colorType}, ${0.45 * p.z})`;
        ctx.fill();

        // Connect nearby nodes (Net effect)
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < connectionDistance) {
            const alpha = (1 - dist / connectionDistance) * 0.22 * p.z * p2.z;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(${p.colorType}, ${alpha})`;
            ctx.lineWidth = 0.8 * p.z;
            ctx.stroke();
          }
        }

        // Connect to mouse if nearby
        if (mouse.active) {
          const dxMouse = mouse.x - p.x;
          const dyMouse = mouse.y - p.y;
          const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
          if (distMouse < mouse.radius * 0.8) {
            const alpha = (1 - distMouse / (mouse.radius * 0.8)) * 0.35;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.strokeStyle = `rgba(${p.colorType}, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [particleCount, connectionDistance, mouseRadius, primaryColor, accentColor, secondaryColor]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-auto absolute inset-0 h-full w-full ${className}`}
      style={{ zIndex: 0 }}
    />
  );
};

export default VantaNetBackground;
