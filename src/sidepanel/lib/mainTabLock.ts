import type { EditorPhase } from "@/store/editor-store";

// 녹화 중엔 Debug 밖으로 못 나간다 — 설정(녹화 방식·30s Replay)·이슈 목록(재제출)·연동(OAuth 창)이
// 진행 중인 세션과 충돌하고, DebugTab의 로그 폴링도 Debug 밖에선 멈춘다.
export function isMainTabLocked(tab: string, phase: EditorPhase): boolean {
  return phase === "recording" && tab !== "debug";
}
