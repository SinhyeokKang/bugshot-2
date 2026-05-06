import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import manifest from "./manifest.config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isStoreBuild = process.env.BUGSHOT_STORE_BUILD === "1";
  // GitHub OAuth client_id는 dev/prod 빌드별로 다른 OAuth App을 사용한다.
  // 스토어 빌드면 VITE_GITHUB_CLIENT_ID_PROD를 VITE_GITHUB_CLIENT_ID로 승격.
  const githubClientId = isStoreBuild
    ? env.VITE_GITHUB_CLIENT_ID_PROD ?? ""
    : env.VITE_GITHUB_CLIENT_ID ?? "";
  return {
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_GITHUB_CLIENT_ID": JSON.stringify(githubClientId),
    },
    build: {},
    server: {
      port: 5173,
      strictPort: true,
      hmr: { port: 5173 },
    },
  };
});
