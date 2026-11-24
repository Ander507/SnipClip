import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

/** The app's own public/ files (icon.png, …) — served next to the harness media. */
function appPublic(): Plugin {
  const dir = path.join(projectRoot, "public");
  const types: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
  return {
    name: "figma-harness-app-public",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        const file = path.join(dir, url);
        if (!url.startsWith("/") || url.includes("..") || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

// Root stays at the project so Tailwind scans src/ exactly like the real build; the harness
// page is served at /figma-harness/index.html and fake media from figma-harness/public.
export default defineConfig({
  root: projectRoot,
  publicDir: path.join(here, "public"),
  cacheDir: path.join(here, ".vite"),
  plugins: [react(), tailwindcss(), appPublic()],
  clearScreen: false,
  // Pre-bundle every dependency the lazily loaded windows use, so the first page load
  // doesn't hit "Outdated Optimize Dep" and a forced reload mid-capture.
  optimizeDeps: { entries: ["figma-harness/index.html", "src/**/*.tsx"] },
  logLevel: "warn",
  server: {
    port: 1430,
    strictPort: false,
    watch: { ignored: ["**/src-tauri/**", "**/figma-harness/out/**"] },
  },
});
