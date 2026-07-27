import { sendBg } from "@/types/messages";
import type { PlatformId } from "@/types/platform";
import type { CaptureMode } from "@/store/editor-store";

// 트림된 영상의 출처. replay_trimmed는 원래 30s Replay 전용이었는데 탭/화면 녹화도 이 플래그를
// 켜기 시작했다 — 지표 의미가 조용히 바뀌지 않게 차원을 하나 더 보낸다.
export type TrimSourceKind = "frames" | "recording";

export function submitEventProperties(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
  replayTrimmed = false,
  trimSource: TrimSourceKind | null = null,
): Record<string, string> {
  return {
    platform,
    capture_mode: captureMode ?? "unknown",
    result,
    replay_trimmed: String(replayTrimmed),
    trim_source: trimSource ?? "none",
  };
}

export function trackSubmit(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
  replayTrimmed = false,
  trimSource: TrimSourceKind | null = null,
): void {
  sendBg({
    type: "analytics.capture",
    event: "issue_submitted",
    properties: submitEventProperties(platform, captureMode, result, replayTrimmed, trimSource),
  }).catch(() => {});
}

export function trackDisconnect(platform: PlatformId): void {
  sendBg({
    type: "analytics.capture",
    event: "platform_disconnected",
    properties: { platform },
  }).catch(() => {});
}
