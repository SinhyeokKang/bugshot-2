import { describe, it, expect } from "vitest";

import {
  OAuthError,
  authorizeRejection,
  grantRejection,
  httpReason,
  type ConnectReason,
} from "../errors";

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

  it("버킷 밖(0·2xx·3xx·600+)은 other — 399가 4xx로 새지 않는다", () => {
    expect(httpReason(0)).toBe("other");
    expect(httpReason(204)).toBe("other");
    expect(httpReason(302)).toBe("other");
    expect(httpReason(399)).toBe("other");
    expect(httpReason(600)).toBe("other");
  });

  it("status가 정수가 아니어도 버킷을 벗어나지 않는다", () => {
    expect(httpReason(Number.NaN)).toBe("other");
    expect(httpReason(-1)).toBe("other");
  });
});

// 두 레인의 존재 이유와 값 선택 근거는 errors.ts의 함수 주석에 있다. 여기선 쌍이
// 실제로 함께 나오는지만 본다 — 한쪽만 맞고 다른 쪽이 어긋나면 result와 reason이
// PostHog에서 서로를 반증한다.
describe("grantRejection (토큰 교환 200+본문 error)", () => {
  it("제공자가 grant를 거부하면 token_exchange_rejected + failed 축", () => {
    expect(grantRejection(false)).toEqual({
      cancelled: false,
      reason: "token_exchange_rejected",
    });
  });

  it("그 거부가 사용자 취소코드면 cancelled_denied + cancelled 축", () => {
    expect(grantRejection(true)).toEqual({ cancelled: true, reason: "cancelled_denied" });
  });
});

describe("authorizeRejection (리다이렉트 ?error=)", () => {
  it("제공자가 authorize를 거부하면 authorize_rejected + failed 축", () => {
    expect(authorizeRejection(false)).toEqual({
      cancelled: false,
      reason: "authorize_rejected",
    });
  });

  it("취소코드면 cancelled_denied + cancelled 축 (두 레인 공통)", () => {
    expect(authorizeRejection(true)).toEqual({
      cancelled: true,
      reason: "cancelled_denied",
    });
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

// 값 집합을 코드 밖에서 고정한다 — 새 값을 추가하면서 대시보드 쿼리를 같이 안 고치면
// 조용히 미분류로 떨어진다. **Record로 받는 게 핵심**이다: 배열 리터럴이면 union에
// 12번째 값이 생겨도 typecheck·테스트 둘 다 통과해 "N개만 존재한다"가 거짓이 된다.
// exhaustive Record는 멤버가 늘면 `pnpm typecheck`가 즉시 막는다.
describe("ConnectReason 값 집합", () => {
  it("12개 값만 존재한다", () => {
    const all: Record<ConnectReason, true> = {
      cancelled_window: true,
      cancelled_denied: true,
      flow_in_progress: true,
      launch_failed: true,
      authorize_rejected: true,
      token_exchange_4xx: true,
      token_exchange_5xx: true,
      token_exchange_rejected: true,
      profile_fetch_failed: true,
      network: true,
      config_missing: true,
      other: true,
    };
    expect(Object.keys(all)).toHaveLength(12);
  });
});
