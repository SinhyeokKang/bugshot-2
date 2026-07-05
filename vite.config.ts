import { defineConfig, loadEnv, type Plugin } from "vite";
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
  // e2e 전용: 앱을 부팅하지 않는 빈 확장 페이지. Playwright는 crxjs가 type:module로 emit하는
  // 서비스워커의 실행 컨텍스트를 못 잡아 worker.evaluate가 hang하므로, chrome.* API 평가를 이
  // 특권 확장 페이지(page.evaluate는 정상)에서 수행한다. dist(배포)엔 미포함.
  const e2eEvalHostPlugin: Plugin | false = isE2eBuild && {
    name: "e2e-eval-host",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "e2e-eval.html",
        source: "<!doctype html><meta charset=utf-8><title>e2e-eval</title>",
      });
    },
  };
  return {
    plugins: [react(), crx({ manifest }), e2eEvalHostPlugin].filter(Boolean),
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
