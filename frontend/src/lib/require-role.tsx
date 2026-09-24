import { Navigate } from "@/lib/router-compat";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/utils/constants";
import type { ReactNode } from "react";

export function RequireRole({
  role,
  children,
}: {
  role: "student" | "guide";
  children: ReactNode;
}) {
  const { user, loading } = useAuth() as { user: { role: string } | null; loading: boolean };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-muted">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  if (user.role !== role) {
    return (
      <Navigate
        to={user.role === "guide" ? ROUTES.GUIDE_DASHBOARD : ROUTES.STUDENT_DASHBOARD}
        replace
      />
    );
  }
  return <>{children}</>;
}
