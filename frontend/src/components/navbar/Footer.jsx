import { Sprout } from "lucide-react";

const Footer = () => (
  <footer className="border-t border-slate-line bg-paper">
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
          <Sprout className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </span>
        <span className="font-display text-sm font-semibold text-slate-ink">TeamSync AI</span>
      </div>
      <p className="text-xs text-slate-muted text-center sm:text-right">
        © {new Date().getFullYear()} TeamSync AI. Built for teams who ship together.
      </p>
    </div>
  </footer>
);

export default Footer;
