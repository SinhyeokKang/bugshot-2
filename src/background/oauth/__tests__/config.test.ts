import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

// oauth.ts(OAuthError) 경유 의존 대비 최소 stub — 기존 *-oauth.test.ts 패턴.
vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import {
  OAUTH_CONFIG,
  isConfigured,
  assertConfigured,
  isCancellation,
  type OAuthPlatformConfig,
} from "../config";
import { OAuthError } from "../../oauth";
import type { PlatformId } from "@/types/platform";

const ALL_PLATFORMS: PlatformId[] = [
  "jira",
  "github",
  "linear",
  "notion",
  "gitlab",
  "asana",
  "clickup",
  "slack",
];

function cfg(overrides: Partial<OAuthPlatformConfig> = {}): OAuthPlatformConfig {
  return {
    platform: "github",
    clientId: "cid",
    needsProxy: true,
    proxyUrl: "https://proxy.example",
    cancelCodes: new Set(["access_denied"]),
    // 실코드는 플랫폼별 기존 i18n 키를 보존한다(jira/github 분리키, 나머지 단일키).
    notConfiguredClientKey: "oauth.error.notConfiguredClient",
    notConfiguredProxyKey: "oauth.error.notConfiguredProxy",
    ...overrides,
  };
}

describe("isConfigured", () => {
  it("clientId + proxy 모두 있으면 true", () => {
    expect(isConfigured(cfg())).toBe(true);
  });

  it("clientId 누락이면 false", () => {
    expect(isConfigured(cfg({ clientId: "" }))).toBe(false);
  });

  it("needsProxy인데 proxyUrl 누락이면 false", () => {
    expect(isConfigured(cfg({ proxyUrl: "" }))).toBe(false);
  });

  it("PKCE(needsProxy=false)는 proxyUrl 없어도 true", () => {
    expect(isConfigured(cfg({ platform: "linear", needsProxy: false, proxyUrl: "" }))).toBe(
      true,
    );
  });
});

describe("assertConfigured", () => {
  it("clientId 누락이면 플랫폼 클라이언트 키로 OAuthError", () => {
    const c = cfg({ platform: "asana", clientId: "" });
    expect(() => assertConfigured(c)).toThrow(OAuthError);
    try {
      assertConfigured(c);
    } catch (e) {
      expect((e as OAuthError).platform).toBe("asana");
      expect((e as Error).message).toContain("notConfiguredClient");
    }
  });

  it("needsProxy인데 proxyUrl 누락이면 공용 proxy 키로 OAuthError", () => {
    const c = cfg({ proxyUrl: "" });
    try {
      assertConfigured(c);
      expect.unreachable("throw 해야 함");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      expect((e as Error).message).toContain("notConfiguredProxy");
    }
  });

  it("구성 완료면 throw 없음 (PKCE 포함)", () => {
    expect(() => assertConfigured(cfg())).not.toThrow();
    expect(() =>
      assertConfigured(cfg({ needsProxy: false, proxyUrl: "" })),
    ).not.toThrow();
  });
});

describe("isCancellation", () => {
  it("cancelCodes에 있는 코드는 true", () => {
    expect(isCancellation(cfg(), "access_denied")).toBe(true);
  });

  it("없는 코드·null은 false", () => {
    expect(isCancellation(cfg(), "server_error")).toBe(false);
    expect(isCancellation(cfg(), null)).toBe(false);
  });
});

describe("OAUTH_CONFIG 테이블", () => {
  it("8개 PlatformId 전부 항목 존재 (jira 포함)", () => {
    for (const p of ALL_PLATFORMS) {
      expect(OAUTH_CONFIG[p], p).toBeDefined();
      expect(OAUTH_CONFIG[p].platform).toBe(p);
      expect(OAUTH_CONFIG[p].cancelCodes).toBeInstanceOf(Set);
    }
  });

  it("linear·gitlab만 PKCE(needsProxy=false), 나머지 6개는 proxy 경유", () => {
    for (const p of ALL_PLATFORMS) {
      expect(OAUTH_CONFIG[p].needsProxy, p).toBe(p !== "linear" && p !== "gitlab");
    }
  });
});
