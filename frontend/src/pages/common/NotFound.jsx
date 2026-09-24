import { Link } from "@/lib/router-compat";
import { Compass } from "lucide-react";
import { ROUTES } from "../../utils/constants";

const NotFound = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-cloud px-6 text-center">
    <div className="w-14 h-14 rounded-xl2 bg-brand-soft flex items-center justify-center mb-5">
      <Compass className="w-7 h-7 text-brand" />
    </div>
    <p className="font-mono text-sm text-slate-muted mb-2">404</p>
    <h1 className="font-display text-2xl font-semibold text-slate-ink mb-2">This page wandered off</h1>
    <p className="text-sm text-slate-muted max-w-sm mb-6">
      The page you're looking for doesn't exist or may have been moved.
    </p>
    <Link to={ROUTES.HOME} className="bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
      Back to home
    </Link>
  </div>
);

export default NotFound;
