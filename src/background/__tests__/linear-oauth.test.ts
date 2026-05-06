import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  identity: {
    getRedirectURL: () => "https://stub.chromiumapp.org/",
  },
});

import {
  generatePkceChallenge,
  isLinearCancellationCode,
  parseLinearCallbackParams,
} from "../linear-oauth";
import { OAuthError } from "../oauth";

describe("parseLinearCallbackParams", () => {
  it("정상 — code/state 일치", () => {
    const out = parseLinearCallbackParams(
      "https://x.chromiumapp.org/?code=abc&state=s1",
      "s1",
    );
    expect(out.code).toBe("abc");
  });

  it("error 파라미터 있으면 OAuthError", () => {
    expect(() =>
      parseLinearCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&error_description=user+declined&state=s1",
        "s1",
      ),
    ).toThrow(OAuthError);
    try {
      parseLinearCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&error_description=user+declined&state=s1",
        "s1",
      );
    } catch (e) {
      expect((e as Error).message).toContain("user declined");
    }
  });

  it("state 불일치 → OAuthError", () => {
    expect(() =>
      parseLinearCallbackParams(
        "https://x.chromiumapp.org/?code=abc&state=other",
        "expected",
      ),
    ).toThrow(OAuthError);
  });

  it("code 없으면 OAuthError", () => {
    expect(() =>
      parseLinearCallbackParams("https://x.chromiumapp.org/?state=s1", "s1"),
    ).toThrow(OAuthError);
  });

  it("access_denied는 cancelled=true, platform=linear", () => {
    try {
      parseLinearCallbackParams(
        "https://x.chromiumapp.org/?error=access_denied&state=s1",
        "s1",
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      const err = e as OAuthError;
      expect(err.platform).toBe("linear");
      expect(err.cancelled).toBe(true);
    }
  });
});

describe("generatePkceChallenge", () => {
  it("codeVerifier는 43자 이상 (base64url of 32 bytes)", async () => {
    const { codeVerifier, codeChallenge } = await generatePkceChallenge();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeChallenge.length).toBeGreaterThanOrEqual(43);
  });

  it("base64url 포맷 (패딩 없음, +/ 없음)", async () => {
    const { codeVerifier, codeChallenge } = await generatePkceChallenge();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("매 호출마다 다른 값 생성", async () => {
    const a = await generatePkceChallenge();
    const b = await generatePkceChallenge();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("isLinearCancellationCode", () => {
  it("access_denied → true", () => {
    expect(isLinearCancellationCode("access_denied")).toBe(true);
  });

  it("server_error / null → false", () => {
    expect(isLinearCancellationCode("server_error")).toBe(false);
    expect(isLinearCancellationCode(null)).toBe(false);
    expect(isLinearCancellationCode("")).toBe(false);
  });
});
