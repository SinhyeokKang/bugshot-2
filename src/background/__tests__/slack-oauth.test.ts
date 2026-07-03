import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import {
  isSlackCancellationCode,
  isSlackOAuthConfigured,
  parseSlackCallbackParams,
} from "../slack-oauth";
import { OAuthError } from "../oauth";

describe("parseSlackCallbackParams", () => {
  it("정상 — code/state 일치", () => {
    const out = parseSlackCallbackParams(
      "https://x.chromiumapp.org/?code=abc&state=s1",
      "s1",
    );
    expect(out.code).toBe("abc");
  });

  it("error 파라미터 있으면 OAuthError (error_description 노출)", () => {
    try {
      parseSlackCallbackParams(
        "https://x.chromiumapp.org/?error=invalid_scope&error_description=bad+scope&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      expect((e as Error).message).toContain("bad scope");
    }
  });

  it("state 불일치 → OAuthError", () => {
    expect(() =>
      parseSlackCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      ),
    ).toThrow(OAuthError);
  });

  it("code 없으면 OAuthError", () => {
    expect(() =>
      parseSlackCallbackParams("https://x.chromiumapp.org/?state=s1", "s1"),
    ).toThrow(OAuthError);
  });

  it("access_denied는 cancelled=true, platform=slack", () => {
    try {
      parseSlackCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      const err = e as OAuthError;
      expect(err.platform).toBe("slack");
      expect(err.cancelled).toBe(true);
    }
  });
});

describe("isSlackCancellationCode", () => {
  it("access_denied만 true, 나머지·null은 false", () => {
    expect(isSlackCancellationCode("access_denied")).toBe(true);
    expect(isSlackCancellationCode("invalid_scope")).toBe(false);
    expect(isSlackCancellationCode(null)).toBe(false);
  });
});

describe("isSlackOAuthConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("CLIENT_ID/PROXY_URL 모두 있으면 true", () => {
    vi.stubEnv("VITE_SLACK_CLIENT_ID", "client-123");
    vi.stubEnv("VITE_OAUTH_PROXY_URL", "https://proxy.example.com");
    expect(isSlackOAuthConfigured()).toBe(true);
  });

  it("VITE_SLACK_CLIENT_ID 비어있으면 false", () => {
    vi.stubEnv("VITE_SLACK_CLIENT_ID", "");
    vi.stubEnv("VITE_OAUTH_PROXY_URL", "https://proxy.example.com");
    expect(isSlackOAuthConfigured()).toBe(false);
  });

  it("VITE_OAUTH_PROXY_URL 비어있으면 false", () => {
    vi.stubEnv("VITE_SLACK_CLIENT_ID", "client-123");
    vi.stubEnv("VITE_OAUTH_PROXY_URL", "");
    expect(isSlackOAuthConfigured()).toBe(false);
  });
});
