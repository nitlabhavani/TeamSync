import { useEffect, useState, useRef } from "react";
import {
  Sparkles,
  ShieldCheck,
  FolderArchive,
  Terminal,
  Cpu,
  Zap,
  CheckCircle2,
  Lock,
} from "lucide-react";

/**
 * High-Tech Animated Video-like Showcase for Auth Pages
 * Inspired by Three.js interactive visuals, Vanta.js halo/rings, and Uiverse cyber-HUD cards.
 */
const AuthAnimationShowcase = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [counter, setCounter] = useState(0);
  const canvasRef = useRef(null);

  const STEPS = [
    { title: "Safe ZIP Extraction", desc: "Zip-slip & bomb protection active", icon: ShieldCheck },
    { title: "AI Code Analysis", desc: "Validating endpoints, models & tests", icon: Cpu },
    { title: "Master ZIP Assembly", desc: "Bundling all 8 modules into 1 ZIP", icon: FolderArchive },
    { title: "Group Chat Delivery", desc: "Real-time socket dispatch & notification", icon: Zap },
  ];

  // Rotate simulation steps
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % STEPS.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [STEPS.length]);

  // Smooth counter animation
  useEffect(() => {
    let start = 0;
    const duration = 2000;
    const stepTime = 20;
    const totalSteps = duration / stepTime;
    const increment = 100 / totalSteps;

    const timer = setInterval(() => {
      start += increment;
      if (start >= 100) {
        setCounter(100);
        clearInterval(timer);
      } else {
        setCounter(Math.floor(start));
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, []);

  // 3D Orbital Rings Canvas Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId;
    let angle = 0;

    const render = () => {
      angle += 0.015;
      const w = (canvas.width = canvas.parentElement?.clientWidth || 300);
      const h = (canvas.height = 180);

      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      // Draw glowing central orb
      const orbGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 35);
      orbGrad.addColorStop(0, "rgba(217, 70, 239, 0.9)");
      orbGrad.addColorStop(0.5, "rgba(99, 102, 241, 0.5)");
      orbGrad.addColorStop(1, "transparent");
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 35, 0, Math.PI * 2);
      ctx.fill();

      // Draw Orbiting Ring 1 (Indigo)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 75, 26, Math.PI / 6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(99, 102, 241, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Satellite node on Ring 1
      const sat1X = Math.cos(angle * 2) * 75;
      const sat1Y = Math.sin(angle * 2) * 26;
      ctx.beginPath();
      ctx.arc(sat1X, sat1Y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#10B981";
      ctx.shadowColor = "#10B981";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();

      // Draw Orbiting Ring 2 (Fuchsia)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-angle * 1.3);
      ctx.beginPath();
      ctx.ellipse(0, 0, 85, 30, -Math.PI / 4, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(217, 70, 239, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Satellite node on Ring 2
      const sat2X = Math.cos(-angle * 2.5) * 85;
      const sat2Y = Math.sin(-angle * 2.5) * 30;
      ctx.beginPath();
      ctx.arc(sat2X, sat2Y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#6366F1";
      ctx.shadowColor = "#6366F1";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="relative space-y-4">
      {/* 3D Holographic Orbit Canvas */}
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/5 p-4 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-mono text-[11px] font-semibold text-white/90">AI Kernel v2.4</span>
          </div>
          <span className="rounded-full bg-mint/20 px-2 py-0.5 font-mono text-[10px] font-bold text-mint">
            {counter}% HEALTH
          </span>
        </div>

        <div className="relative my-2 h-[140px] w-full flex items-center justify-center">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        {/* Dynamic Simulation Terminal */}
        <div className="rounded-xl bg-black/40 p-3 font-mono text-[11px] text-white/80 space-y-1.5 border border-white/10">
          <div className="flex items-center justify-between text-[10px] text-white/50">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3 text-brand" /> process.audit
            </span>
            <span className="text-mint">OK 200</span>
          </div>
          <div className="flex items-center gap-2 text-white">
            <span className="text-mint">✔</span>
            <span className="truncate">{STEPS[activeStep].title}: {STEPS[activeStep].desc}</span>
          </div>
        </div>
      </div>

      {/* Floating Status Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
          <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">ZIP Bundling</p>
          <p className="text-xs font-bold text-white mt-0.5 flex items-center gap-1">
            <FolderArchive className="w-3.5 h-3.5 text-mint" /> Auto-Combined
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
          <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">Privacy Core</p>
          <p className="text-xs font-bold text-white mt-0.5 flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-purple-400" /> Private Peer Chats
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthAnimationShowcase;
