import { describe, expect, it } from "vitest";
import { isAtlassianCancellationCode, OAuthError, serializeOAuthError } from "../oauth";
import { BgError, isOAuthCancelled, isOAuthRefreshFailed, getOAuthErrorPlatform, isOAuthNotConfigured } from "@/lib/bg-client";

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

  // 인증 창을 못 띄운 것도 "만료"가 아니다. 401로 내리면 최초 연결 시도에서
  // onOAuthExpired가 발화해 연결한 적 없는 사용자에게 재로그인 안내가 뜬다.
  it("인증 창 실패 → status 400, 만료로 오분류하지 않는다", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("authorization window failed", {
        platform: "linear",
        launchFailed: true,
      }),
    );
    expect(status).toBe(400);
    const err = new BgError("authorization window failed", status, body);
    expect(isOAuthRefreshFailed(err)).toBe(false);
    expect(isOAuthCancelled(err)).toBe(false);
    expect(getOAuthErrorPlatform(err)).toBe("linear");
  });

  // 기대값 정정: 이 케이스는 플래그 없는 OAuthError가 401로 떨어지던 **버그**를 계약처럼
  // 굳히고 있었다. 401 레인은 이제 명시 플래그로만 탄다.
  it("refresh 실패 → isOAuthRefreshFailed + status 401 + platform 일치", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("expired", { platform: "notion", refreshFailed: true }),
    );
    expect(status).toBe(401);
    const err = new BgError("expired", status, body);
    expect(isOAuthRefreshFailed(err)).toBe(true);
    expect(isOAuthCancelled(err)).toBe(false);
    expect(getOAuthErrorPlatform(err)).toBe("notion");
  });

  // 🔴 본체: state mismatch·code 부재·토큰 저장 실패 등 **최초 연결 단계** throw가 전부
  // 기본값으로 401을 달고 나가, 사이드패널이 연동한 적 없는 사용자에게 "세션 만료"를 띄웠다.
  it("플래그 없는 OAuthError → 400, 만료로 오분류하지 않는다", () => {
    const { status, body } = serializeOAuthError(
      new OAuthError("state mismatch", { platform: "github" }),
    );
    expect(status).toBe(400);
    const err = new BgError("state mismatch", status, body);
    expect(isOAuthRefreshFailed(err)).toBe(false);
    expect(isOAuthCancelled(err)).toBe(false);
    expect(getOAuthErrorPlatform(err)).toBe("github");
  });

  it("취소·설정누락·창실패가 refreshFailed보다 우선한다", () => {
    expect(
      serializeOAuthError(new OAuthError("x", { refreshFailed: true, cancelled: true })).status,
    ).toBeUndefined();
    expect(
      serializeOAuthError(new OAuthError("x", { refreshFailed: true, notConfigured: true })).status,
    ).toBe(400);
    expect(
      serializeOAuthError(new OAuthError("x", { refreshFailed: true, launchFailed: true })).status,
    ).toBe(400);
  });
});

describe("OAuthError.refreshFailed", () => {
  it("기본값은 false (options bag + ?? false 패턴)", () => {
    expect(new OAuthError("x").refreshFailed).toBe(false);
  });

  it("옵션으로 켤 수 있다", () => {
    expect(new OAuthError("x", { refreshFailed: true }).refreshFailed).toBe(true);
  });
});
