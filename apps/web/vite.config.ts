import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

function pagesBase(): string {
  const raw = process.env.PAGES_BASE?.trim();
  if (!raw) {
    return "./";
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export default defineConfig({
  root,
  base: pagesBase(),
  plugins: [react()],
  resolve: {
    alias: {
      "@art-stock/core": resolve(root, "../../packages/core/src/index.ts"),
      "@art-stock/s3": resolve(root, "../../packages/s3/src/index.ts"),
      "@art-stock/ui": resolve(root, "../../packages/ui/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [resolve(root, "../..")] },
  },
});
