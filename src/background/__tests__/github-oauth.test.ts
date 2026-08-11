import { describe, expect, it, vi } from "vitest";

// chrome.identity는 background 환경 전용이라 모킹 필요. parseCallbackParams는
// chrome 의존이 없지만 모듈 로드 시 setGithubRefreshHook 호출이 있어 stub 필요.
vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import { isGithubCancellationCode, parseCallbackParams, refreshGithubToken } from "../github-oauth";
import { OAUTH_CONFIG } from "../oauth/config";
import { OAuthError } from "../oauth";

describe("parseCallbackParams", () => {
  it("정상 — code/state 일치", () => {
    const out = parseCallbackParams(
      "https://x.chromiumapp.org/?code=abc&state=s1",
      "s1",
    );
    expect(out.code).toBe("abc");
  });

  it("error 파라미터 있으면 OAuthError(error_description)", () => {
    expect(() =>
      parseCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&error_description=user+declined&state=s1",
        "s1",
      ),
    ).toThrow(OAuthError);
    try {
      parseCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&error_description=user+declined&state=s1",
        "s1",
      );
    } catch (e) {
      expect((e as Error).message).toContain("user declined");
    }
  });

  it("error_description 없으면 error 코드를 메시지로", () => {
    try {
      parseCallbackParams(
        "https://x.chromiumapp.org/?error=server_error&state=s1",
        "s1",
      );
    } catch (e) {
      expect((e as Error).message).toContain("server_error");
    }
  });

  it("state 불일치 → OAuthError", () => {
    expect(() =>
      parseCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      ),
    ).toThrow(OAuthError);
  });

  it("code 없으면 OAuthError", () => {
    expect(() =>
      parseCallbackParams("https://x.chromiumapp.org/?state=s1", "s1"),
    ).toThrow(OAuthError);
  });

  it("OAuthError에 platform=github + access_denied는 cancelled=true", () => {
    try {
      parseCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      const err = e as OAuthError;
      expect(err.platform).toBe("github");
      expect(err.cancelled).toBe(true);
    }
  });

  it("일반 에러(server_error)는 cancelled=false", () => {
    try {
      parseCallbackParams(
        "https://x.chromiumapp.org/?error=server_error&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as OAuthError;
      expect(err.platform).toBe("github");
      expect(err.cancelled).toBe(false);
    }
  });

  it("state mismatch는 platform=github + cancelled=false", () => {
    try {
      parseCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      );
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as OAuthError;
      expect(err.platform).toBe("github");
      expect(err.cancelled).toBe(false);
    }
  });
});

describe("isGithubCancellationCode", () => {
  it("access_denied → true", () => {
    expect(isGithubCancellationCode("access_denied")).toBe(true);
  });

  it("application_suspended → false (관리자 앱 일시중지는 사용자 취소가 아님)", () => {
    expect(isGithubCancellationCode("application_suspended")).toBe(false);
  });

  it("server_error / null → false", () => {
    expect(isGithubCancellationCode("server_error")).toBe(false);
    expect(isGithubCancellationCode(null)).toBe(false);
    expect(isGithubCancellationCode("")).toBe(false);
  });
});

// 종전엔 이 경로만 맨 OAuthError를 던져 notConfigured 플래그가 빠졌고, 그러면
// serializeOAuthError의 401 fallthrough에 걸려 "세션 만료"로 오분류됐다.
// 나머지 4개 플랫폼 refresh와 같은 assertConfigured 경로를 쓰는지 고정한다.
describe("refreshGithubToken 설정 누락 분류", () => {
  it("clientId가 없으면 notConfigured + config_missing으로 던진다", async () => {
    const cfg = OAUTH_CONFIG.github;
    const spy = vi.spyOn(cfg, "clientId", "get").mockReturnValue("");

    try {
      await refreshGithubToken({
        kind: "oauth",
        accessToken: "at",
        refreshToken: "rt",
        tokenType: "bearer",
        scope: "repo",
        viewerLogin: "u",
        grantedAt: Date.now(),
      });
      expect.unreachable("설정 누락이면 throw해야 한다");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      const e = err as OAuthError;
      expect(e.notConfigured).toBe(true);
      expect(e.reason).toBe("config_missing");
    } finally {
      spy.mockRestore();
    }
  });

  it("refreshToken이 아예 없으면 재인증 안내로 갈린다(설정 누락과 구분)", async () => {
    await expect(
      refreshGithubToken({
        kind: "oauth",
        accessToken: "at",
        tokenType: "bearer",
        scope: "repo",
        viewerLogin: "u",
        grantedAt: Date.now(),
      }),
    ).rejects.toThrow(/refresh token/);
  });
});
