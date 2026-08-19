import type { PlatformId } from "@/types/platform";

// oauth.ts와 config.ts가 공유하는 leaf — 순환 import 방지용으로 분리.

// PostHog `platform_connect`의 사유 축. result(success/cancelled/failed) 3값만으로는
// "진짜 장애"와 "사용자 이탈"이 한 버킷에 뭉쳐 사후 분해가 불가능하다(2026-07-30 회고).
// **고정 enum만 나간다** — 상류 error_description·응답 본문은 이 축에 절대 싣지 않는다.
export type ConnectReason =
  | "cancelled_window"
  | "cancelled_denied"
  | "flow_in_progress"
  | "launch_failed"
  | "authorize_rejected"
  | "token_exchange_4xx"
  | "token_exchange_5xx"
  | "token_exchange_rejected"
  // 토큰은 받았는데 직후 프로필 조회(getMyself)가 실패. 대개 scope 부족·제공자 5xx다.
  | "profile_fetch_failed"
  | "network"
  | "config_missing"
  | "other";

// status를 두 버킷으로만 뭉갠다 — 원문을 안 싣는 게 목적이므로 세분화하지 않는다.
export function httpReason(status: number): ConnectReason {
  if (status >= 400 && status < 500) return "token_exchange_4xx";
  if (status >= 500 && status < 600) return "token_exchange_5xx";
  return "other";
}

// 제공자가 거부한 두 레인. **값이 아니라 `cancelled`/`reason` 쌍을 반환하는 게 핵심**이다 —
// 호출부가 둘을 따로 넘기면 `{cancelled: false, reason: "cancelled_denied"}` 같은 모순
// 조합이 타입상 표현 가능해지고, 그러면 PostHog에서 result와 reason이 서로를 반증한다.
// 반환 타입을 명시하는 것도 필수다 — 생략하면 삼항이 `string`으로 넓어지고, `as
// ConnectReason`으로 좁히면 이번엔 오타(`cancelled_denyed`)가 그대로 통과한다.
type Rejection = { cancelled: boolean; reason: ConnectReason };

// GitHub는 `bad_verification_code`를, Slack은 `ok:false`를 **200 + 본문 error**로 준다.
// status가 200이라 httpReason으로는 못 덮어 두 플랫폼의 가장 흔한 교환 실패가 미분류로
// 떨어진다. 요청은 상류에 닿았고 grant만 거부된 경우라 4xx/5xx와도 구분해서 센다.
export function grantRejection(cancelled: boolean): Rejection {
  return { cancelled, reason: cancelled ? "cancelled_denied" : "token_exchange_rejected" };
}

// authorize 리다이렉트는 토큰 교환 **이전** 단계다. 여기서 나오는 `invalid_client`·
// `invalid_scope`는 배포·설정 사고 신호라, 사용자 재시도로 풀리는 교환 실패와 같은
// 버킷에 뭉치면 이 축을 만든 이유가 사라진다.
export function authorizeRejection(cancelled: boolean): Rejection {
  return { cancelled, reason: cancelled ? "cancelled_denied" : "authorize_rejected" };
}

export interface OAuthErrorOptions {
  platform?: PlatformId;
  cancelled?: boolean;
  // 빌드에 client_id·proxy URL이 없어 시작조차 못 한 경우. "세션 만료"와 구분해야 한다 —
  // 연결한 적 없는 사용자에게 만료 안내가 뜨던 회귀(A-23).
  notConfigured?: boolean;
  // 인증 창을 띄우는 단계에서 실패한 경우(로드 실패·타임아웃·동시 flow 등). notConfigured와
  // 같은 이유로 "세션 만료"와 구분한다 — 최초 연결 시도라 만료될 토큰 자체가 없다.
  launchFailed?: boolean;
  // 401 레인(= 사이드패널의 재로그인 안내)을 켜는 유일한 스위치. 누가 세우고 누가 벗기는지는
  // lib/connectLane.ts 헤더가 정본이다.
  refreshFailed?: boolean;
  // 집계 전용 축. 위 3축이 표현 못 하는 사유(창 닫기 vs 제공자 거부, 4xx vs 5xx)를 가른다.
  // serializeOAuthError의 status 레인에는 관여하지 않는다 — 그건 위 refreshFailed가
  // 가른다(2026-07-30 회고가 "근본 해법"으로 남겨둔 401 기본값 반전이 그것이다).
  reason?: ConnectReason;
}

export class OAuthError extends Error {
  cancelled: boolean;
  notConfigured: boolean;
  launchFailed: boolean;
  refreshFailed: boolean;
  platform?: PlatformId;
  reason?: ConnectReason;
  constructor(message: string, options: OAuthErrorOptions = {}) {
    super(message);
    this.name = "OAuthError";
    this.cancelled = options.cancelled ?? false;
    this.notConfigured = options.notConfigured ?? false;
    this.launchFailed = options.launchFailed ?? false;
    this.refreshFailed = options.refreshFailed ?? false;
    this.platform = options.platform;
    this.reason = options.reason;
  }
}
