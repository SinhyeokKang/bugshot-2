import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import { isAsanaOAuthConfigured, parseAsanaCallbackParams } from "../asana-oauth";
import { OAuthError } from "../oauth";

describe("parseAsanaCallbackParams", () => {
  it("정상 — code/state 일치", () => {
    const out = parseAsanaCallbackParams(
      "https://x.chromiumapp.org/?code=abc&state=s1",
      "s1",
    );
    expect(out.code).toBe("abc");
  });

  it("error 파라미터 있으면 OAuthError (error_description 노출)", () => {
    try {
      parseAsanaCallbackParams(
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
      parseAsanaCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      ),
    ).toThrow(OAuthError);
  });

  it("code 없으면 OAuthError", () => {
    expect(() =>
      parseAsanaCallbackParams("https://x.chromiumapp.org/?state=s1", "s1"),
    ).toThrow(OAuthError);
  });

  it("access_denied는 cancelled=true, platform=asana", () => {
    try {
      parseAsanaCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      const err = e as OAuthError;
      expect(err.platform).toBe("asana");
      expect(err.cancelled).toBe(true);
    }
  });
});

describe("isAsanaOAuthConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("VITE_ASANA_CLIENT_ID 있으면 true", () => {
    vi.stubEnv("VITE_ASANA_CLIENT_ID", "client-123");
    expect(isAsanaOAuthConfigured()).toBe(true);
  });

  it("VITE_ASANA_CLIENT_ID 비어있으면 false", () => {
    vi.stubEnv("VITE_ASANA_CLIENT_ID", "");
    expect(isAsanaOAuthConfigured()).toBe(false);
  });
});
