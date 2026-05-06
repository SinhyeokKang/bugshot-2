import { describe, expect, it, vi } from "vitest";

// chrome.identity는 background 환경 전용이라 모킹 필요. parseCallbackParams는
// chrome 의존이 없지만 모듈 로드 시 setGithubRefreshHook 호출이 있어 stub 필요.
vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import { isGithubCancellationCode, parseCallbackParams } from "../github-oauth";
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
