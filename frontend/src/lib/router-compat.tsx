/**
 * Thin compatibility layer so the TeamSync AI pages (originally written against
 * react-router-dom) run on TanStack Router without rewriting every page.
 */
import {
  Link as TSLink,
  Outlet as TSOutlet,
  useNavigate as useTSNavigate,
  useParams as useTSParams,
  useSearch as useTSSearch,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

type AnyProps = Record<string, unknown>;

export const Outlet = TSOutlet;

export function Link({ to, children, ...rest }: AnyProps & { to: string; children?: ReactNode }) {
  return (
    <TSLink to={to} {...(rest as AnyProps)}>
      {children as ReactNode}
    </TSLink>
  );
}

export function NavLink({
  to,
  className,
  children,
  end,
  ...rest
}: AnyProps & {
  to: string;
  end?: boolean;
  className?: string | ((s: { isActive: boolean }) => string);
  children?: ReactNode | ((s: { isActive: boolean }) => ReactNode);
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <TSLink
      to={to}
      className={typeof className === "function" ? className({ isActive }) : className}
      {...(rest as AnyProps)}
    >
      {typeof children === "function" ? children({ isActive }) : children}
    </TSLink>
  );
}

export function useNavigate() {
  const navigate = useTSNavigate();
  return (to: string | number, options?: { replace?: boolean }) => {
    if (typeof to === "number") {
      if (typeof window !== "undefined") window.history.go(to);
      return;
    }
    navigate({ to, replace: options?.replace });
  };
}

export function useParams<T = Record<string, string>>() {
  return useTSParams({ strict: false }) as T;
}

export function useSearch<T = Record<string, unknown>>() {
  return useTSSearch({ strict: false }) as T;
}

export function useLocation() {
  return useRouterState({ select: (s) => s.location });
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useTSNavigate();
  useEffect(() => {
    navigate({ to, replace });
  }, [to, replace, navigate]);
  return null;
}
