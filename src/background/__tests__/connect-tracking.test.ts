import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyConnectReason,
  classifyConnectResult,
  trackConnect,
} from "../connect-tracking";
import { OAuthError } from "../oauth";
import type { ConnectReason } from "../oauth/errors";

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

// result 3값만으로는 PostHog에서 "진짜 장애"와 "사용자 취소"를 가를 수 없다. reason은
// 그 사유 축이고, 상류 응답 원문 대신 고정 enum만 싣는다(Privacy 코어밸류).
describe("classifyConnectReason", () => {
  it("명시 태깅된 reason이 항상 우선한다 (파생 규칙이 덮어쓰지 않는다)", () => {
    // launchOAuthWebFlow가 창 닫기에 다는 조합 — cancelled 축과 reason이 동시에 선다.
    expect(
      classifyConnectReason(
        new OAuthError("x", { cancelled: true, reason: "cancelled_window" }),
      ),
    ).toBe("cancelled_window");
    // 동시 flow는 취소가 아니라 launchFailed 축인데 사유는 따로 봐야 한다.
    expect(
      classifyConnectReason(
        new OAuthError("x", { launchFailed: true, reason: "flow_in_progress" }),
      ),
    ).toBe("flow_in_progress");
    expect(
      classifyConnectReason(new OAuthError("x", { reason: "token_exchange_5xx" })),
    ).toBe("token_exchange_5xx");
  });

  it("태깅 없는 cancelled는 제공자 화면 거부로 파생 (창 닫기는 launch 단계에서 태깅됨)", () => {
    expect(classifyConnectReason(new OAuthError("x", { cancelled: true }))).toBe(
      "cancelled_denied",
    );
  });

  it("태깅 없는 notConfigured는 config_missing", () => {
    expect(classifyConnectReason(new OAuthError("x", { notConfigured: true }))).toBe(
      "config_missing",
    );
  });

  it("태깅 없는 launchFailed는 launch_failed", () => {
    expect(classifyConnectReason(new OAuthError("x", { launchFailed: true }))).toBe(
      "launch_failed",
    );
  });

  it("축이 하나도 안 선 OAuthError는 other (stateMismatch·codeMissing·tokenPersist 등)", () => {
    expect(classifyConnectReason(new OAuthError("state mismatch"))).toBe("other");
  });

  it("비-OAuthError 네트워크 실패는 network", () => {
    expect(classifyConnectReason(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyConnectReason(new Error("NetworkError when attempting to fetch"))).toBe(
      "network",
    );
    // Safari/WebKit 계열 문구.
    expect(classifyConnectReason(new Error("Load failed"))).toBe("network");
  });

  it("TypeError는 메시지가 달라도 network (fetch 실패의 표준 형태)", () => {
    expect(classifyConnectReason(new TypeError("boom"))).toBe("network");
  });

  it("그 밖의 값은 전부 other", () => {
    expect(classifyConnectReason(new Error("boom"))).toBe("other");
    expect(classifyConnectReason(null)).toBe("other");
    expect(classifyConnectReason(undefined)).toBe("other");
    expect(classifyConnectReason("oops")).toBe("other");
  });
});

// 두 축이 어긋나면 PostHog에 `result=cancelled, reason=token_exchange_5xx` 같은 모순
// 조합이 생겨 어느 쪽을 믿어야 할지 알 수 없게 된다. 한쪽만 고치는 회귀를 여기서 막는다.
describe("result ↔ reason 정합성 불변식", () => {
  const cases: Array<{ err: unknown; reason: ConnectReason }> = [
    { err: new OAuthError("x", { cancelled: true, reason: "cancelled_window" }), reason: "cancelled_window" },
    { err: new OAuthError("x", { cancelled: true }), reason: "cancelled_denied" },
    { err: new OAuthError("x", { launchFailed: true, reason: "flow_in_progress" }), reason: "flow_in_progress" },
    { err: new OAuthError("x", { launchFailed: true }), reason: "launch_failed" },
    { err: new OAuthError("x", { notConfigured: true }), reason: "config_missing" },
    { err: new OAuthError("x", { reason: "token_exchange_4xx" }), reason: "token_exchange_4xx" },
    { err: new OAuthError("x", { reason: "token_exchange_5xx" }), reason: "token_exchange_5xx" },
    { err: new TypeError("Failed to fetch"), reason: "network" },
    { err: new Error("boom"), reason: "other" },
  ];

  it.each(cases)("reason=$reason", ({ err, reason }) => {
    expect(classifyConnectReason(err)).toBe(reason);
    expect(classifyConnectResult(err)).toBe(
      reason.startsWith("cancelled_") ? "cancelled" : "failed",
    );
  });
});

describe("trackConnect", () => {
  it("성공 시 run 반환값을 그대로 반환하고 result=success로 기록", async () => {
    const auth = { accessToken: "tok" };
    const result = await trackConnect("github", async () => auth);

    expect(result).toBe(auth);
    // 성공엔 사유가 없다 — 빈 문자열도 "other"도 아닌 키 부재여야 PostHog에서
    // `reason is not set`으로 성공 코호트를 깔끔히 가를 수 있다.
    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "github",
      result: "success",
    });
  });

  it("취소(OAuthError cancelled)면 원본 에러를 그대로 rethrow하고 result=cancelled + reason", async () => {
    const err = new OAuthError("cancelled", { cancelled: true });

    await expect(
      trackConnect("jira", async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "jira",
      result: "cancelled",
      reason: "cancelled_denied",
    });
  });

  it("실패(raw TypeError)면 원본 에러를 그대로 rethrow하고 result=failed + reason", async () => {
    const err = new TypeError("Failed to fetch");

    await expect(
      trackConnect("linear", async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "linear",
      result: "failed",
      reason: "network",
    });
  });

  it("토큰 교환 5xx는 result=failed + token_exchange_5xx (진짜 장애 신호)", async () => {
    const err = new OAuthError("token exchange 503", { reason: "token_exchange_5xx" });

    await expect(
      trackConnect("slack", async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(mockCapture).toHaveBeenCalledWith("platform_connect", {
      platform: "slack",
      result: "failed",
      reason: "token_exchange_5xx",
    });
  });

  it("에러 메시지 원문은 어떤 경로로도 payload에 실리지 않는다", async () => {
    const err = new OAuthError("token exchange failed (401) {\"error\":\"bad_verification_code\"}", {
      reason: "token_exchange_4xx",
    });

    await trackConnect("notion", async () => {
      throw err;
    }).catch(() => {});

    const [, props] = mockCapture.mock.calls[0];
    expect(JSON.stringify(props)).not.toContain("bad_verification_code");
    expect(Object.keys(props).sort()).toEqual(["platform", "reason", "result"]);
  });
});
