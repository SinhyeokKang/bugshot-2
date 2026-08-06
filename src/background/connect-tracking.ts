import type { PlatformId } from "@/types/platform";
import { captureEvent } from "./analytics";
import { OAuthError } from "./oauth";
import type { ConnectReason } from "./oauth/errors";

export function classifyConnectResult(err: unknown): "cancelled" | "failed" {
  return err instanceof OAuthError && err.cancelled ? "cancelled" : "failed";
}

const NETWORK_MESSAGE = /failed to fetch|networkerror|load failed/i;

// result 3값은 "사용자가 그만뒀다"와 "우리 쪽이 터졌다"를 한 버킷에 뭉친다. 사유 축이 없어
// 2026-07-30 회귀도 지표만 보고는 진단이 안 됐다(창 닫기가 통째로 failed였다).
// 명시 태깅이 없으면 기존 3축에서 파생한다 — 전 throw 지점에 태깅을 강제하면 누락 하나가
// 조용한 오분류가 되므로, 태깅은 축이 못 가르는 곳(창 닫기/동시 flow/HTTP 버킷)에만 둔다.
export function classifyConnectReason(err: unknown): ConnectReason {
  if (err instanceof OAuthError) {
    if (err.reason) return err.reason;
    if (err.cancelled) return "cancelled_denied";
    if (err.notConfigured) return "config_missing";
    if (err.launchFailed) return "launch_failed";
    return "other";
  }
  // fetch 실패는 TypeError로 오지만 메시지는 엔진마다 다르다(Chrome "Failed to fetch",
  // WebKit "Load failed"). 타입과 문구 둘 다 본다.
  if (err instanceof TypeError) return "network";
  if (err instanceof Error && NETWORK_MESSAGE.test(err.message)) return "network";
  // 토큰 교환 성공 직후의 getMyself 실패. 8개 플랫폼이 각자 GithubError·SlackError… 를
  // 던지는데 전부 숫자 status를 갖는다. 이걸 OAuthError로 **감싸면 안 된다** —
  // serializeOAuthError의 401 fallthrough에 걸려 최초 연결 사용자에게 "세션이
  // 만료되었습니다"가 뜬다(2026-07-30 회고의 2차 함정). 그래서 duck-typing으로만 읽는다.
  // status로 4xx/5xx를 쪼개지 않는 건 Slack이 실패에도 status 200을 쓰기 때문.
  if (err instanceof Error && typeof (err as { status?: unknown }).status === "number") {
    return "profile_fetch_failed";
  }
  return "other";
}

// OAuth 시작 흐름을 감싸 platform_connect 이벤트를 기록한다. 실패 시 원본 에러를
// 그대로 rethrow해야 사이드패널의 취소 토스트 억제(isOAuthCancelled)가 깨지지 않는다.
export async function trackConnect<T>(
  platform: PlatformId,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    // 성공엔 사유가 없다 — 키 자체를 빼야 PostHog에서 `reason is not set`으로 성공
    // 코호트가 깔끔히 갈린다("other" 같은 채움값을 넣으면 미분류 실패와 섞인다).
    void captureEvent("platform_connect", { platform, result: "success" });
    return result;
  } catch (err) {
    void captureEvent("platform_connect", {
      platform,
      result: classifyConnectResult(err),
      reason: classifyConnectReason(err),
    });
    throw err;
  }
}
