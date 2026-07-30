import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthError, classifyLaunchFlowError, launchOAuthWebFlow } from "../oauth";

// PostHog `platform_connect: failed` 과다 집계의 회귀 테스트.
//
// Promise 형태의 chrome.identity.launchWebAuthFlow는 사용자가 인증 창을 닫으면
// resolve(undefined)가 아니라 reject("The user did not approve access.")한다
// (Chromium identity_constants.h). 각 start*OAuth의 `if (!redirect)` 취소 분기는
// 이 경로에서 도달하지 않으므로, 가장 흔한 취소가 raw Error로 새어나가
// connect-tracking의 classifyConnectResult에서 통째로 `failed`로 분류됐다.
// 부수적으로 사이드패널의 isOAuthCancelled 억제도 빠져나가 영문 원문 토스트가 떴다.
// 8개 플랫폼 공통 경로라 여기서 한 번 막는다.

describe("classifyLaunchFlowError", () => {
  it("창 닫기(user did not approve) → 취소로 분류", () => {
    const result = classifyLaunchFlowError("The user did not approve access.");
    expect(result).not.toBeNull();
    expect(result?.cancelled).toBe(true);
  });

  it("창 닫기 판정은 대소문자·마침표 변형에 견딘다", () => {
    expect(
      classifyLaunchFlowError("the user did not approve access")?.cancelled,
    ).toBe(true);
  });

  it("인증 페이지 로드 실패 → 취소 아님 (기존 동작 유지)", () => {
    const result = classifyLaunchFlowError("Authorization page could not be loaded.");
    expect(result?.cancelled).toBe(false);
    expect(result?.key).toBe("oauth.error.authorizationPageFailed");
  });

  it("인증 페이지 타임아웃 → 취소 아님", () => {
    const result = classifyLaunchFlowError("Authorization page load timed out.");
    expect(result?.cancelled).toBe(false);
    expect(result?.key).toBe("oauth.error.authorizationPageTimeout");
  });

  it("인증 창 생성 실패 → 취소 아님", () => {
    const result = classifyLaunchFlowError(
      "Couldn't create a browser window to display an authorization page.",
    );
    expect(result?.cancelled).toBe(false);
    expect(result?.key).toBe("oauth.error.windowCreateFailed");
  });

  it("브라우저 컨텍스트 종료 → 취소 아님", () => {
    const result = classifyLaunchFlowError("The browser context has been shut down");
    expect(result?.cancelled).toBe(false);
    expect(result?.key).toBe("oauth.error.browserContextShutDown");
  });

  // 두 플랫폼을 연달아 연결하려 할 때 나온다. 취소가 아니므로 failed가 맞지만,
  // 사용자에게는 "이미 진행 중" 안내가 필요하다.
  it("다른 flow 진행 중 → 취소 아님", () => {
    const result = classifyLaunchFlowError(
      "Only one web auth flow is allowed at a time.",
    );
    expect(result?.cancelled).toBe(false);
    expect(result?.key).toBe("oauth.error.flowAlreadyInProgress");
  });

  it("알 수 없는 메시지·빈 문자열은 분류하지 않는다 (과매칭 방지)", () => {
    expect(classifyLaunchFlowError("Failed to fetch")).toBeNull();
    expect(classifyLaunchFlowError("Token exchange failed (500)")).toBeNull();
    expect(classifyLaunchFlowError("")).toBeNull();
  });

  it("취소 판정이 무관한 approve 문구를 삼키지 않는다", () => {
    expect(classifyLaunchFlowError("The admin did not approve the app install")).toBeNull();
  });
});

describe("launchOAuthWebFlow", () => {
  let launchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    launchMock = vi.fn();
    vi.stubGlobal("chrome", { identity: { launchWebAuthFlow: launchMock } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("정상 redirect URL을 그대로 반환한다", async () => {
    launchMock.mockResolvedValue("https://abc.chromiumapp.org/?code=X");
    await expect(launchOAuthWebFlow("https://auth.example", "github")).resolves.toBe(
      "https://abc.chromiumapp.org/?code=X",
    );
  });

  it("창 닫기 reject → cancelled OAuthError + platform", async () => {
    launchMock.mockRejectedValue(new Error("The user did not approve access."));

    const err = await launchOAuthWebFlow("https://auth.example", "slack").catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).cancelled).toBe(true);
    expect((err as OAuthError).platform).toBe("slack");
  });

  it("동시 flow reject → cancelled 아닌 OAuthError + platform", async () => {
    launchMock.mockRejectedValue(
      new Error("Only one web auth flow is allowed at a time."),
    );

    const err = await launchOAuthWebFlow("https://auth.example", "linear").catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).cancelled).toBe(false);
    expect((err as OAuthError).platform).toBe("linear");
  });

  it("분류 밖 에러는 원본을 그대로 rethrow한다", async () => {
    const original = new TypeError("Failed to fetch");
    launchMock.mockRejectedValue(original);

    const err = await launchOAuthWebFlow("https://auth.example", "notion").catch(
      (e: unknown) => e,
    );

    expect(err).toBe(original);
  });

  it("Error가 아닌 reject 값도 원본 그대로 rethrow한다", async () => {
    launchMock.mockRejectedValue("boom");

    const err = await launchOAuthWebFlow("https://auth.example", "asana").catch(
      (e: unknown) => e,
    );

    expect(err).toBe("boom");
  });
});
