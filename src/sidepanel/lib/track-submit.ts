import { sendBg } from "@/types/messages";
import type { PlatformId } from "@/types/platform";
import type { CaptureMode } from "@/store/editor-store";

export function submitEventProperties(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
): Record<string, string> {
  return {
    platform,
    capture_mode: captureMode ?? "unknown",
    result,
  };
}

export function trackSubmit(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
): void {
  sendBg({
    type: "analytics.capture",
    event: "issue_submitted",
    properties: submitEventProperties(platform, captureMode, result),
  }).catch(() => {});
}
