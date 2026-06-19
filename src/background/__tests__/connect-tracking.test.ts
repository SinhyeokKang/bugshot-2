import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyConnectResult, trackConnect } from "../connect-tracking";
import { OAuthError } from "../oauth";

vi.mock("../analytics", () => ({
  captureEvent: vi.fn(async () => {}),
}));

import { captureEvent } from "../analytics";
const mockCapture = vi.mocked(captureEvent);

beforeEach(() => {
  mockCapture.mockClear();
});

describe("classifyConnectResult", () => {
  it("OAuthError(cancelled:true)면 cancelled", () => {
    expect(classifyConnectResult(new OAuthError("x", { cancelled: true }))).toBe(
      "cancelled",
    );
  });

  it("OAuthError(cancelled:false)면 failed", () => {
    expect(classifyConnectResult(new OAuthError("x", { cancelled: false }))).toBe(
      "failed",
    );
  });

  it("일반 Error는 failed", () => {
    expect(classifyConnectResult(new Error("boom"))).toBe("failed");
  });

  it("raw TypeError(Failed to fetch)는 failed", () => {
    expect(classifyConnectResult(new TypeError("Failed to fetch"))).toBe("failed");
  });

  it("non-Error 값(null/undefined/string)은 failed", () => {
    expect(classifyConnectResult(null)).toBe("failed");
    expect(classifyConnectResult(undefined)).toBe("failed");
    expect(classifyConnectResult("oops")).toBe("failed");
  });
});

describe("trackConnect", () => {
  it("성공 시 run 반환값을 그대로 반환하고 result=success로 기록", async () => {
    const auth = { accessToken: "tok" };
    const result = await trackConnect("github", async () => auth);

    expect(result).toBe(auth);
    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "github",
      result: "success",
    });
  });

  it("취소(OAuthError cancelled)면 원본 에러를 그대로 rethrow하고 result=cancelled", async () => {
    const err = new OAuthError("cancelled", { cancelled: true });

    await expect(
      trackConnect("jira", async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "jira",
      result: "cancelled",
    });
  });

  it("실패(raw TypeError)면 원본 에러를 그대로 rethrow하고 result=failed", async () => {
    const err = new TypeError("Failed to fetch");

    await expect(
      trackConnect("linear", async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "linear",
      result: "failed",
    });
  });
});
