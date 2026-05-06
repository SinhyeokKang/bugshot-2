import { describe, expect, it, vi } from "vitest";

// 테스트는 BG response body 모양만 검증한다. i18n은 sendBg 경로에서만 t()를 쓰는데
// 본 테스트는 sendBg를 호출하지 않아 i18n 의존성을 끊을 필요가 있다.
vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));
vi.mock("@/store/app-settings-store", () => ({
  useAppSettingsStore: () => "ko",
}));

import {
  BgError,
  getOAuthErrorPlatform,
  isOAuthCancelled,
  isOAuthRefreshFailed,
} from "../messages";

describe("isOAuthRefreshFailed", () => {
  it("body에 oauthRefreshFailed=true면 true", () => {
    const err = new BgError("expired", 401, { oauthRefreshFailed: true, platform: "jira" });
    expect(isOAuthRefreshFailed(err)).toBe(true);
  });

  it("oauthRefreshFailed가 false거나 없으면 false", () => {
    expect(isOAuthRefreshFailed(new BgError("x", 500, {}))).toBe(false);
    expect(isOAuthRefreshFailed(new BgError("x", 500, { oauthRefreshFailed: false }))).toBe(false);
    expect(isOAuthRefreshFailed(new BgError("x"))).toBe(false);
  });

  it("BgError가 아니면 false", () => {
    expect(isOAuthRefreshFailed(new Error("plain"))).toBe(false);
    expect(isOAuthRefreshFailed("string error")).toBe(false);
    expect(isOAuthRefreshFailed(null)).toBe(false);
  });

  it("body가 객체가 아니면 false", () => {
    expect(isOAuthRefreshFailed(new BgError("x", 401, "not-an-object"))).toBe(false);
    expect(isOAuthRefreshFailed(new BgError("x", 401, undefined))).toBe(false);
  });
});

describe("isOAuthCancelled", () => {
  it("body에 oauthCancelled=true면 true", () => {
    const err = new BgError("user cancel", undefined, { oauthCancelled: true, platform: "github" });
    expect(isOAuthCancelled(err)).toBe(true);
  });

  it("oauthCancelled false/없음 → false", () => {
    expect(isOAuthCancelled(new BgError("x", 401, { oauthRefreshFailed: true }))).toBe(false);
    expect(isOAuthCancelled(new BgError("x"))).toBe(false);
  });

  it("기존 정규식 매칭 메시지(cancelled 등)도 body 플래그 없으면 false — 메시지 텍스트 매칭 안 함", () => {
    expect(
      isOAuthCancelled(new BgError("user cancelled the OAuth", undefined, undefined)),
    ).toBe(false);
  });
});

describe("getOAuthErrorPlatform", () => {
  it("body.platform이 'jira'면 'jira'", () => {
    expect(
      getOAuthErrorPlatform(new BgError("x", 401, { oauthRefreshFailed: true, platform: "jira" })),
    ).toBe("jira");
  });

  it("body.platform이 'github'면 'github'", () => {
    expect(
      getOAuthErrorPlatform(new BgError("x", 401, { oauthRefreshFailed: true, platform: "github" })),
    ).toBe("github");
  });

  it("body.platform이 'linear'면 'linear'", () => {
    expect(
      getOAuthErrorPlatform(new BgError("x", 401, { oauthRefreshFailed: true, platform: "linear" })),
    ).toBe("linear");
  });

  it("platform이 없거나 알 수 없는 값이면 null", () => {
    expect(
      getOAuthErrorPlatform(new BgError("x", 401, { oauthRefreshFailed: true })),
    ).toBeNull();
    expect(
      getOAuthErrorPlatform(new BgError("x", 401, { platform: "notion" })),
    ).toBeNull();
  });

  it("BgError가 아니면 null", () => {
    expect(getOAuthErrorPlatform(new Error("plain"))).toBeNull();
    expect(getOAuthErrorPlatform(null)).toBeNull();
  });
});
