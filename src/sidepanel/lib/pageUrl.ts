import type { CaptureMode } from "./buildCaptureFiles";

export interface ResolvePageUrlInput {
  captureMode: CaptureMode;
  targetUrl: string | null | undefined;
  livePageUrl: string | null;
}

// 재현 환경 `Page` 값의 단일 출처.
//
// freeform만 추적하고 캡처 3모드는 동결하는 이유: 스크린샷·영상은 그 페이지의 산출물이라
// Page가 따라 움직이면 이미지와 값이 어긋난다. freeform은 산출물이 없고 로그가
// 네비게이션을 넘어 누적되므로(mergeLogItems) 지금 보고 있는 페이지가 재현 위치다.
export function resolvePageUrl(input: ResolvePageUrlInput): string {
  if (input.captureMode === "freeform" && input.livePageUrl) {
    return input.livePageUrl;
  }
  return input.targetUrl ?? "";
}

// state의 어느 필드를 리졸버에 먹이는가를 여기서만 정한다. 호출부마다 3필드를 손으로
// 조립하면 생산 지점 하나가 조용히 빠진다 — 실제로 PreviewPanel의 복사 본문 4분기가
// 그렇게 빠졌다(POSTMORTEM 2026-09-04의 복제본 계열). 그물은 `pageUrl-callsites.test.ts`.
//
// EditorState가 아니라 구조 타입을 받는다 — store를 import하면 순환이 생기고, 이 모듈을
// 쓰는 테스트가 store 모킹에 끌려 들어간다.
export function selectPageUrl(s: {
  captureMode: CaptureMode;
  target: { url: string } | null;
  livePageUrl: string | null;
}): string {
  return resolvePageUrl({
    captureMode: s.captureMode,
    targetUrl: s.target?.url,
    livePageUrl: s.livePageUrl,
  });
}
