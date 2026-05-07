import { describe, expect, it } from "vitest";
import { isAtlassianCancellationCode, OAuthError } from "../oauth";

describe("OAuthError options", () => {
  it("기본 — cancelled false, platform undefined", () => {
    const err = new OAuthError("oops");
    expect(err.cancelled).toBe(false);
    expect(err.platform).toBeUndefined();
    expect(err.message).toBe("oops");
    expect(err.name).toBe("OAuthError");
  });

  it("cancelled / platform 옵션 반영", () => {
    const err = new OAuthError("user dropped", { platform: "jira", cancelled: true });
    expect(err.cancelled).toBe(true);
    expect(err.platform).toBe("jira");
  });

  it("instanceof Error", () => {
    expect(new OAuthError("x")).toBeInstanceOf(Error);
  });
});

describe("isAtlassianCancellationCode", () => {
  it("access_denied → true", () => {
    expect(isAtlassianCancellationCode("access_denied")).toBe(true);
  });

  it("user_cancelled_login / user_cancelled_authorize → true", () => {
    expect(isAtlassianCancellationCode("user_cancelled_login")).toBe(true);
    expect(isAtlassianCancellationCode("user_cancelled_authorize")).toBe(true);
  });

  it("server_error / null / 빈 문자열 → false", () => {
    expect(isAtlassianCancellationCode("server_error")).toBe(false);
    expect(isAtlassianCancellationCode(null)).toBe(false);
    expect(isAtlassianCancellationCode("")).toBe(false);
  });
});
