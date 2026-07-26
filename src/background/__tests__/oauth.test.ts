import { describe, expect, it } from "vitest";
import { isAtlassianCancellationCode, OAuthError, serializeOAuthError } from "../oauth";
import { BgError, isOAuthCancelled, isOAuthRefreshFailed, getOAuthErrorPlatform, isOAuthNotConfigured } from "@/types/messages";

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

describe("serializeOAuthError ↔ messages 판독부 round-trip", () => {
  it("cancelled → isOAuthCancelled + platform 일치, status undefined", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("user dropped", { platform: "github", cancelled: true }),
    );
    expect(status).toBeUndefined();
    const err = new BgError("user dropped", status, body);
    expect(isOAuthCancelled(err)).toBe(true);
    expect(isOAuthRefreshFailed(err)).toBe(false);
    expect(getOAuthErrorPlatform(err)).toBe("github");
  });

  // VITE_OAUTH_PROXY_URL 없이 빌드된 확장에서 "GitHub 연결"을 누르면 이 경로를 탄다.
  // 401로 내리면 App이 onOAuthExpired를 발화해, 연결한 적도 없는 사용자에게
  // "세션이 만료되었습니다"가 떴다.
  it("설정 누락 → isOAuthNotConfigured + status 400, 만료로 오분류하지 않는다", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("proxy not configured", {
        platform: "github",
        notConfigured: true,
      }),
    );
    expect(status).toBe(400);
    const err = new BgError("proxy not configured", status, body);
    expect(isOAuthNotConfigured(err)).toBe(true);
    expect(isOAuthRefreshFailed(err)).toBe(false);
    expect(isOAuthCancelled(err)).toBe(false);
    expect(getOAuthErrorPlatform(err)).toBe("github");
  });

  it("취소가 설정 누락보다 우선한다 (사용자 의도 우선)", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("x", { platform: "jira", cancelled: true, notConfigured: true }),
    );
    expect(status).toBeUndefined();
    const err = new BgError("x", status, body);
    expect(isOAuthCancelled(err)).toBe(true);
    expect(isOAuthNotConfigured(err)).toBe(false);
  });

  it("refresh 실패 → isOAuthRefreshFailed + status 401 + platform 일치", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("expired", { platform: "notion" }),
    );
    expect(status).toBe(401);
    const err = new BgError("expired", status, body);
    expect(isOAuthRefreshFailed(err)).toBe(true);
    expect(isOAuthCancelled(err)).toBe(false);
    expect(getOAuthErrorPlatform(err)).toBe("notion");
  });
});
