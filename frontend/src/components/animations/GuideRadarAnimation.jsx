import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  FolderArchive,
  LineChart,
  Users,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

/**
 * 3D Radar Scanner & Guide Approval Simulation Animation
 * Inspired by Vanta.js radar/halo, Three.js rotating beam, and Shadcn analytics widgets.
 */
const GuideRadarAnimation = () => {
  const canvasRef = useRef(null);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId;
    let angle = 0;

    const render = () => {
      angle += 0.035;
      const w = (canvas.width = canvas.parentElement?.clientWidth || 200);
      const h = (canvas.height = 140);
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(cx, cy) - 10;

      ctx.clearRect(0, 0, w, h);

      // Draw concentric radar rings
      ctx.strokeStyle = "rgba(16, 185, 129, 0.25)";
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.strokeStyle = "rgba(16, 185, 129, 0.15)";
      ctx.stroke();

      // Rotating radar sweep beam
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      const beamGrad = ctx.createLinearGradient(0, 0, r, 0);
      beamGrad.addColorStop(0, "rgba(16, 185, 129, 0.8)");
      beamGrad.addColorStop(1, "transparent");

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, 0, Math.PI / 4);
      ctx.closePath();
      ctx.fillStyle = "rgba(16, 185, 129, 0.15)";
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r, 0);
      ctx.strokeStyle = "rgba(16, 185, 129, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // Team node blips on radar
      const blips = [
        { x: cx + r * 0.45, y: cy - r * 0.3, color: "#10B981" },
        { x: cx - r * 0.5, y: cy + r * 0.25, color: "#6366F1" },
        { x: cx + r * 0.2, y: cy + r * 0.6, color: "#F59E0B" },
      ];

      blips.forEach((b) => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 6;
        ctx.fill();
      });

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-xl text-white space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-mint/20 text-mint flex items-center justify-center font-bold text-xs">
            <LineChart className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-bold text-white">Live Supervision Radar</p>
            <p className="text-[10px] text-white/50">3 Teams Supervised · Real-Time</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-mint/20 text-mint text-[10px] font-bold uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-mint animate-ping" />
          Active
        </span>
      </div>

      {/* Radar Canvas & Health Blips */}
      <div className="relative h-[130px] w-full flex items-center justify-center bg-black/40 rounded-xl border border-white/10 overflow-hidden">
        <canvas ref={canvasRef} className="h-full w-full" />
        <div className="absolute top-2 left-2 text-[9px] font-mono text-white/40">
          SCANNING 360°
        </div>
      </div>

      {/* Team Cards Status */}
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between rounded-xl bg-white/5 p-2.5 border border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-mint" />
            <span className="font-semibold text-white">Team Vision</span>
          </div>
          <span className="font-mono text-mint text-[11px] font-bold">100% Complete</span>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-white/5 p-2.5 border border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand" />
            <span className="font-semibold text-white">Team Nimbus</span>
          </div>
          <span className="font-mono text-white/70 text-[11px]">88% In Review</span>
        </div>
      </div>

      {/* Quick Approval Action */}
      <div className="pt-1">
        <button
          onClick={() => setApproved(!approved)}
          className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${
            approved
              ? "bg-mint text-slate-900 shadow-mint/30"
              : "bg-brand hover:bg-brand-deep text-white shadow-brand/30"
          }`}
        >
          {approved ? (
            <>
              <CheckCircle2 className="w-4 h-4" /> Approved & Master ZIP Delivered to Chat
            </>
          ) : (
            <>
              <FolderArchive className="w-4 h-4" /> Approve & Deliver Consolidated ZIP
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default GuideRadarAnimation;
