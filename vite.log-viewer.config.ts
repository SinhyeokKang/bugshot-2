import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: "src/log-viewer",
  resolve: {
    alias: {
      "@/i18n": path.resolve(__dirname, "./src/log-viewer/i18n.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../../dist-log-viewer",
    emptyOutDir: true,
  },
});
