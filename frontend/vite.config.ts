/**
 * TanStack Start + Vite config, using standard public packages directly
 * (previously wrapped by a third-party config package that pulled from a
 * private registry — replaced so `npm install` works with only the public
 * npm registry). Every plugin below was already an explicit dependency in
 * package.json beforehand, so no capability was lost.
 *
 * Two behaviors from the old wrapper were intentionally NOT carried over,
 * since they were tied to that platform's own hosted preview environment:
 *   - auto-detected dev server host/port — replaced below with this
 *     project's actual expected port (8080, matching backend/.env
 *     CLIENT_ORIGIN and README.md), set explicitly.
 *   - a build-time error/analytics reporting plugin — this app already has
 *     its own error reporting (src/lib/error-reporting.ts).
 *
 * NOTE: this file could not be verified with an actual `npm run build` /
 * `npm run dev` in the environment this change was made in (no network
 * access to install dependencies). The previous working config is kept as
 * vite.config.original-backup.ts.txt for comparison/rollback if needed.
 */
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 8080,
    strictPort: true,
  },
  resolve: {
    // Avoid duplicate React instances if any dependency bundles its own copy.
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // Unchanged from the previous config — redirects TanStack Start's
      // bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
    }),
    viteReact(),
  ],
});
