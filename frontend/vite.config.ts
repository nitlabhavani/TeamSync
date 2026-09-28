import { defineConfig } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 8080,
    strictPort: true,
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    viteReact(),
  ],
});
