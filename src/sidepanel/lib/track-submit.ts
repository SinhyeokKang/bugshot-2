import { sendBg } from "@/lib/bg-client";
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
  // Jira 한정 — 이번 제출의 프로젝트가 계정 기본값과 달랐나. 다른 플랫폼은 축이 없어 안 싣는다.
  projectOverridden: boolean | null = null,
  // Jira 한정 — 스프린트 행이 떴나 / 실제로 골랐나. 목록 조회 실패를 전부 삼키므로(design R6)
  // 이 두 축이 유일한 사후 관측 수단이고, 둘은 독립이어야 "떴는데 안 골랐다"가 표현된다.
  sprintFieldShown: boolean | null = null,
  sprintSelected: boolean | null = null,
): Record<string, string> {
  return {
    platform,
    capture_mode: captureMode ?? "unknown",
    result,
    replay_trimmed: String(replayTrimmed),
    trim_source: trimSource ?? "none",
    ...(projectOverridden === null ? {} : { project_overridden: String(projectOverridden) }),
    ...(sprintFieldShown === null ? {} : { sprint_field_shown: String(sprintFieldShown) }),
    ...(sprintSelected === null ? {} : { sprint_selected: String(sprintSelected) }),
  };
}

export function trackSubmit(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
  replayTrimmed = false,
  trimSource: TrimSourceKind | null = null,
  projectOverridden: boolean | null = null,
  sprintFieldShown: boolean | null = null,
  sprintSelected: boolean | null = null,
): void {
  sendBg({
    type: "analytics.capture",
    event: "issue_submitted",
    properties: submitEventProperties(
      platform,
      captureMode,
      result,
      replayTrimmed,
      trimSource,
      projectOverridden,
      sprintFieldShown,
      sprintSelected,
    ),
  }).catch(() => {});
}

export function trackDisconnect(platform: PlatformId): void {
  sendBg({
    type: "analytics.capture",
    event: "platform_disconnected",
    properties: { platform },
  }).catch(() => {});
}
