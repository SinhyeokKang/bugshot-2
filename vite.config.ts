import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import manifest from "./manifest.config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isStoreBuild = process.env.BUGSHOT_STORE_BUILD === "1";
  const isE2eBuild = process.env.BUGSHOT_E2E_BUILD === "1";
  // GitHub OAuth client_id는 dev/prod 빌드별로 다른 OAuth App을 사용한다.
  // 스토어 빌드면 VITE_GITHUB_CLIENT_ID_PROD를 VITE_GITHUB_CLIENT_ID로 승격.
  const githubClientId = isStoreBuild
    ? env.VITE_GITHUB_CLIENT_ID_PROD ?? ""
    : env.VITE_GITHUB_CLIENT_ID ?? "";
  // PostHog 키도 store 빌드에서만 PROD 값을 승격 → dev/일반/e2e는 빈 값으로 전송 no-op.
  const posthogKey = isStoreBuild
    ? env.VITE_POSTHOG_KEY_PROD ?? ""
    : env.VITE_POSTHOG_KEY ?? "";
  return {
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_GITHUB_CLIENT_ID": JSON.stringify(githubClientId),
      "import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(posthogKey),
    },
    build: { outDir: isE2eBuild ? "dist-e2e" : "dist" },
    server: {
      port: 5173,
      strictPort: true,
      hmr: { port: 5173 },
    },
  };
});
