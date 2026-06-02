import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import { parseGitlabCallbackParams } from "../gitlab-oauth";
import { OAuthError } from "../oauth";

describe("parseGitlabCallbackParams", () => {
  it("정상 — code/state 일치", () => {
    const out = parseGitlabCallbackParams(
      "https://x.chromiumapp.org/?code=abc&state=s1",
      "s1",
    );
    expect(out.code).toBe("abc");
  });

  it("error 파라미터 있으면 OAuthError (error_description 노출)", () => {
    try {
      parseGitlabCallbackParams(
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
      parseGitlabCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      ),
    ).toThrow(OAuthError);
  });

  it("code 없으면 OAuthError", () => {
    expect(() =>
      parseGitlabCallbackParams("https://x.chromiumapp.org/?state=s1", "s1"),
    ).toThrow(OAuthError);
  });

  it("access_denied는 cancelled=true, platform=gitlab", () => {
    try {
      parseGitlabCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      const err = e as OAuthError;
      expect(err.platform).toBe("gitlab");
      expect(err.cancelled).toBe(true);
    }
  });
});
