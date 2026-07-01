import { sendBg } from "@/types/messages";
import type { PlatformId } from "@/types/platform";
import type { CaptureMode } from "@/store/editor-store";

export function submitEventProperties(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
  replayTrimmed = false,
): Record<string, string> {
  return {
    platform,
    capture_mode: captureMode ?? "unknown",
    result,
    replay_trimmed: String(replayTrimmed),
  };
}

export function trackSubmit(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
  replayTrimmed = false,
): void {
  sendBg({
    type: "analytics.capture",
    event: "issue_submitted",
    properties: submitEventProperties(platform, captureMode, result, replayTrimmed),
  }).catch(() => {});
}

export function trackDisconnect(platform: PlatformId): void {
  sendBg({
    type: "analytics.capture",
    event: "platform_disconnected",
    properties: { platform },
  }).catch(() => {});
}
