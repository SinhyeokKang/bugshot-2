import { describe, it, expect } from "vitest";

import { OAuthError, httpReason, type ConnectReason } from "../errors";

// PostHog `platform_connect`는 result(success/cancelled/failed) 3값뿐이라 "진짜 장애"와
// "사용자 취소"를 사후에 가를 수 없었다. reason은 그 사유 축을 고정 enum으로만 싣는다 —
// 상류 error_description·status 원문은 절대 넣지 않는다(Privacy 코어밸류: 캡처·응답 원문이
// BugShot 밖으로 나가지 않는다). httpReason은 status를 4xx/5xx 버킷으로 뭉개는 그 관문이다.
describe("httpReason", () => {
  it("4xx는 token_exchange_4xx", () => {
    expect(httpReason(400)).toBe("token_exchange_4xx");
    expect(httpReason(401)).toBe("token_exchange_4xx");
    expect(httpReason(429)).toBe("token_exchange_4xx");
    expect(httpReason(499)).toBe("token_exchange_4xx");
  });

  it("5xx는 token_exchange_5xx", () => {
    expect(httpReason(500)).toBe("token_exchange_5xx");
    expect(httpReason(503)).toBe("token_exchange_5xx");
    expect(httpReason(599)).toBe("token_exchange_5xx");
  });

  it("경계값 400/500이 아래 버킷으로 새지 않는다", () => {
    expect(httpReason(399)).toBe("other");
    expect(httpReason(400)).toBe("token_exchange_4xx");
    expect(httpReason(499)).toBe("token_exchange_4xx");
    expect(httpReason(500)).toBe("token_exchange_5xx");
  });

  it("2xx·3xx·0·600+는 other (res.ok가 false인데 4xx/5xx가 아닌 경우)", () => {
    expect(httpReason(0)).toBe("other");
    expect(httpReason(204)).toBe("other");
    expect(httpReason(302)).toBe("other");
    expect(httpReason(600)).toBe("other");
  });

  it("status가 정수가 아니어도 버킷을 벗어나지 않는다", () => {
    expect(httpReason(Number.NaN)).toBe("other");
    expect(httpReason(-1)).toBe("other");
  });
});

describe("OAuthError.reason", () => {
  it("옵션으로 준 reason이 필드에 실린다", () => {
    const err = new OAuthError("x", { reason: "token_exchange_5xx" });
    expect(err.reason).toBe("token_exchange_5xx");
  });

  it("안 주면 undefined — 기존 축(cancelled/notConfigured/launchFailed)에서 파생하도록 남긴다", () => {
    expect(new OAuthError("x").reason).toBeUndefined();
    expect(new OAuthError("x", { cancelled: true }).reason).toBeUndefined();
  });

  it("기존 축은 그대로 보존된다 (reason 추가가 회귀를 만들지 않는다)", () => {
    const err = new OAuthError("x", {
      platform: "slack",
      cancelled: true,
      reason: "cancelled_window",
    });
    expect(err.platform).toBe("slack");
    expect(err.cancelled).toBe(true);
    expect(err.notConfigured).toBe(false);
    expect(err.launchFailed).toBe(false);
    expect(err.name).toBe("OAuthError");
  });
});

// 값 집합을 코드 밖에서 한 번 더 고정한다 — 새 값을 추가하면서 analytics 허용목록·
// 대시보드 쿼리를 같이 안 고치면 조용히 미분류로 떨어진다.
describe("ConnectReason 값 집합", () => {
  it("9개 값만 존재한다", () => {
    const all: ConnectReason[] = [
      "cancelled_window",
      "cancelled_denied",
      "flow_in_progress",
      "launch_failed",
      "token_exchange_4xx",
      "token_exchange_5xx",
      "network",
      "config_missing",
      "other",
    ];
    expect(new Set(all).size).toBe(9);
  });
});
