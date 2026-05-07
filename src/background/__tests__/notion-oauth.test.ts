import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import {
  isNotionCancellationCode,
  parseNotionCallbackParams,
} from "../notion-oauth";
import { OAuthError } from "../oauth";

describe("parseNotionCallbackParams", () => {
  it("정상 — code/state 일치", () => {
    const out = parseNotionCallbackParams(
      "https://x.chromiumapp.org/?code=abc&state=s1",
      "s1",
    );
    expect(out.code).toBe("abc");
  });

  it("error 파라미터 있으면 OAuthError + platform=notion", () => {
    try {
      parseNotionCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&error_description=user+declined&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      const err = e as OAuthError;
      expect(err.platform).toBe("notion");
      expect(err.message).toContain("user declined");
      expect(err.cancelled).toBe(true);
    }
  });

  it("state 불일치 → OAuthError", () => {
    expect(() =>
      parseNotionCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      ),
    ).toThrow(OAuthError);
  });

  it("code 없으면 OAuthError", () => {
    expect(() =>
      parseNotionCallbackParams(
        "https://x.chromiumapp.org/?state=s1",
        "s1",
      ),
    ).toThrow(OAuthError);
  });

  it("user_denied도 cancelled=true", () => {
    try {
      parseNotionCallbackParams(
        "https://x.chromiumapp.org/?error=user_denied&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OAuthError).cancelled).toBe(true);
    }
  });
});

describe("isNotionCancellationCode", () => {
  it("access_denied / user_denied → true", () => {
    expect(isNotionCancellationCode("access_denied")).toBe(true);
    expect(isNotionCancellationCode("user_denied")).toBe(true);
  });

  it("server_error / null / 빈 문자열 → false", () => {
    expect(isNotionCancellationCode("server_error")).toBe(false);
    expect(isNotionCancellationCode(null)).toBe(false);
    expect(isNotionCancellationCode("")).toBe(false);
  });
});
