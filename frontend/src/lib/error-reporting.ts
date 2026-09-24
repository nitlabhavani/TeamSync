type AppErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type ErrorReportingHooks = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: AppErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __errorReportingHooks?: ErrorReportingHooks;
    __reportRuntimeError?: (payload: {
      message: string;
      stack?: string;
      filename?: string;
    }) => void;
  }
}

/**
 * Reports a caught error to any external error-tracking integration that has
 * registered itself on `window.__errorReportingHooks` / `window.__reportRuntimeError`
 * (e.g. Sentry, a custom logger, etc.), and always logs to the console.
 *
 * Loaders and server fns commonly throw a raw Response; String(it) is the
 * opaque "[object Response]", so pull out the status and URL instead.
 */
export function reportAppError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  // Always log locally so errors are visible even with no reporting integration wired up.
  console.error(`[TeamSync AI] ${message}`, error);

  window.__errorReportingHooks?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );

  window.__reportRuntimeError?.({
    message,
    stack: error instanceof Error ? error.stack : undefined,
    filename: window.location.pathname,
  });
}
