import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportAppError } from "../lib/error-reporting";
import { AuthProvider } from "../context/AuthContext";
import { GroupProvider } from "../context/GroupContext";
import { ChatProvider } from "../context/ChatContext";
import { NotificationProvider } from "../context/NotificationContext";
import { SocketProvider } from "../context/SocketContext";
import { CallProvider } from "../context/CallContext";
import CallOverlay from "../components/chat/CallOverlay";
import { Toaster } from "../components/ui/sonner";
import { ThemeProvider } from "../context/ThemeContext";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportAppError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TeamSync AI — AI collaboration for project teams" },
      {
        name: "description",
        content:
          "TeamSync AI gives student project teams chat, file sharing, tasks, meetings and AI collaboration insights in one workspace.",
      },
      { name: "author", content: "TeamSync AI" },
      { property: "og:title", content: "TeamSync AI — AI collaboration for project teams" },
      {
        property: "og:description",
        content:
          "Chat, files, Kanban tasks, meetings, peer reviews and AI risk radar for student project teams.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico?v=teamsync-2", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem("teamsync_theme");
                  var savedBg = localStorage.getItem("teamsync_bg_theme");
                  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
                  var isDark = saved === "dark" || (saved !== "light" && prefersDark);
                  if (isDark) {
                    document.documentElement.classList.add("dark");
                    document.documentElement.style.colorScheme = "dark";
                  } else {
                    document.documentElement.classList.remove("dark");
                    document.documentElement.style.colorScheme = "light";
                  }
                  if (savedBg && savedBg !== "default") {
                    document.documentElement.setAttribute("data-bg-theme", savedBg);
                  } else {
                    document.documentElement.removeAttribute("data-bg-theme");
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
        <SocketProvider>
          <GroupProvider>
            <ChatProvider>
              <CallProvider>
                <NotificationProvider>
                  {/* Required: nested routes render here. */}
                  <Outlet />
                  <Toaster />
                  {/* Mounted app-wide (not just on the private chat route) so an
                      incoming private call still rings no matter which page the
                      recipient is currently on — see CallContext.jsx. Renders
                      nothing unless a private call is ringing/active. */}
                  <CallOverlay />
                </NotificationProvider>
              </CallProvider>
            </ChatProvider>
          </GroupProvider>
        </SocketProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
