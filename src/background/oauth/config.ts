import { t } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import type { PlatformId } from "@/types/platform";
// oauth.ts와 순환 import — 양쪽 모두 교차 바인딩을 함수 내부에서만 써야 한다
// (top-level 접근 추가 시 TDZ로 깨짐).
import { OAuthError } from "../oauth";

export interface OAuthPlatformConfig {
  platform: PlatformId;
  clientId: string;
  needsProxy: boolean;
  proxyUrl: string;
  cancelCodes: Set<string>;
  notConfiguredClientKey: TranslationKey;
  notConfiguredProxyKey: TranslationKey;
}

// clientId/proxyUrl은 getter로 lazy 조회 — 테스트가 vi.stubEnv로 런타임 주입하는
// 기존 동작(asana/clickup/slack) 보존. import.meta.env 리터럴이라 빌드 치환도 유지.
function proxyUrl(): string {
  return (import.meta.env.VITE_OAUTH_PROXY_URL ?? "").trim().replace(/\/+$/, "");
}

export const OAUTH_CONFIG = {
  jira: {
    platform: "jira",
    get clientId() {
      return (import.meta.env.VITE_ATLASSIAN_CLIENT_ID ?? "").trim();
    },
    needsProxy: true,
    get proxyUrl() {
      return proxyUrl();
    },
    cancelCodes: new Set([
      "access_denied",
      "user_cancelled_login",
      "user_cancelled_authorize",
    ]),
    notConfiguredClientKey: "oauth.error.notConfiguredClient",
    notConfiguredProxyKey: "oauth.error.notConfiguredProxy",
  },
  github: {
    platform: "github",
    get clientId() {
      return (import.meta.env.VITE_GITHUB_CLIENT_ID ?? "").trim();
    },
    needsProxy: true,
    get proxyUrl() {
      return proxyUrl();
    },
    cancelCodes: new Set(["access_denied"]),
    notConfiguredClientKey: "oauth.error.github.notConfiguredClient",
    notConfiguredProxyKey: "oauth.error.notConfiguredProxy",
  },
  linear: {
    platform: "linear",
    get clientId() {
      return (import.meta.env.VITE_LINEAR_CLIENT_ID ?? "").trim();
    },
    needsProxy: false,
    proxyUrl: "",
    cancelCodes: new Set(["access_denied"]),
    notConfiguredClientKey: "linear.oauth.notConfigured",
    notConfiguredProxyKey: "linear.oauth.notConfigured",
  },
  notion: {
    platform: "notion",
    get clientId() {
      return (import.meta.env.VITE_NOTION_CLIENT_ID ?? "").trim();
    },
    needsProxy: true,
    get proxyUrl() {
      return proxyUrl();
    },
    cancelCodes: new Set(["access_denied", "user_denied"]),
    notConfiguredClientKey: "notion.oauth.notConfigured",
    notConfiguredProxyKey: "notion.oauth.notConfigured",
  },
  gitlab: {
    platform: "gitlab",
    get clientId() {
      return (import.meta.env.VITE_GITLAB_CLIENT_ID ?? "").trim();
    },
    needsProxy: false,
    proxyUrl: "",
    cancelCodes: new Set(["access_denied"]),
    notConfiguredClientKey: "gitlab.oauth.notConfigured",
    notConfiguredProxyKey: "gitlab.oauth.notConfigured",
  },
  asana: {
    platform: "asana",
    get clientId() {
      return (import.meta.env.VITE_ASANA_CLIENT_ID ?? "").trim();
    },
    needsProxy: true,
    get proxyUrl() {
      return proxyUrl();
    },
    cancelCodes: new Set(["access_denied"]),
    notConfiguredClientKey: "asana.oauth.notConfigured",
    notConfiguredProxyKey: "asana.oauth.notConfigured",
  },
  clickup: {
    platform: "clickup",
    get clientId() {
      return (import.meta.env.VITE_CLICKUP_CLIENT_ID ?? "").trim();
    },
    needsProxy: true,
    get proxyUrl() {
      return proxyUrl();
    },
    cancelCodes: new Set(["access_denied"]),
    notConfiguredClientKey: "clickup.oauth.notConfigured",
    notConfiguredProxyKey: "clickup.oauth.notConfigured",
  },
  slack: {
    platform: "slack",
    get clientId() {
      return (import.meta.env.VITE_SLACK_CLIENT_ID ?? "").trim();
    },
    needsProxy: true,
    get proxyUrl() {
      return proxyUrl();
    },
    cancelCodes: new Set(["access_denied"]),
    notConfiguredClientKey: "slack.oauth.notConfigured",
    notConfiguredProxyKey: "slack.oauth.notConfigured",
  },
} satisfies Record<PlatformId, OAuthPlatformConfig>;

export function isConfigured(cfg: OAuthPlatformConfig): boolean {
  return !!cfg.clientId && (!cfg.needsProxy || !!cfg.proxyUrl);
}

export function assertConfigured(cfg: OAuthPlatformConfig): void {
  if (!cfg.clientId) {
    throw new OAuthError(t(cfg.notConfiguredClientKey), {
      platform: cfg.platform,
    });
  }
  if (cfg.needsProxy && !cfg.proxyUrl) {
    throw new OAuthError(t(cfg.notConfiguredProxyKey), {
      platform: cfg.platform,
    });
  }
}

export function isCancellation(
  cfg: OAuthPlatformConfig,
  code: string | null,
): boolean {
  return !!code && cfg.cancelCodes.has(code);
}
