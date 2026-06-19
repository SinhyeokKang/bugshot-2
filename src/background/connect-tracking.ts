import type { PlatformId } from "@/types/platform";
import { captureEvent } from "./analytics";
import { OAuthError } from "./oauth";

export function classifyConnectResult(err: unknown): "cancelled" | "failed" {
  return err instanceof OAuthError && err.cancelled ? "cancelled" : "failed";
}

// OAuth 시작 흐름을 감싸 platform_connect 이벤트를 기록한다. 실패 시 원본 에러를
// 그대로 rethrow해야 사이드패널의 취소 토스트 억제(isOAuthCancelled)가 깨지지 않는다.
export async function trackConnect<T>(
  platform: PlatformId,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    void captureEvent("platform_connect", { platform, result: "success" });
    return result;
  } catch (err) {
    void captureEvent("platform_connect", {
      platform,
      result: classifyConnectResult(err),
    });
    throw err;
  }
}
