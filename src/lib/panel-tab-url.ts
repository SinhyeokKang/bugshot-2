// background SW와 사이드패널이 함께 무는 leaf — 런타임 import 0을 유지한다
// (`__tests__/panel-tab-url.test.ts`가 소스 스캔으로 강제). panelBase는 호출부가
// `chrome.runtime.getURL(PANEL_PATH)`로 만들어 넘긴다.

export const PANEL_PATH = "src/sidepanel/index.html";

/** panelBase와 같은 origin·path이고 쿼리 tabId가 0 이상 정수일 때만 그 값을 돌려준다. */
export function parsePanelTabTarget(url: string | undefined, panelBase: string): number | null {
  if (!url) return null;
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(panelBase);
  } catch {
    return null;
  }
  // origin 대신 protocol·host — 비특수 스킴(chrome-extension:)의 origin은 런타임에 따라 "null"로 접혀
  // 다른 확장끼리 같은 값이 된다.
  if (
    parsed.protocol !== base.protocol ||
    parsed.host !== base.host ||
    parsed.pathname !== base.pathname
  )
    return null;
  const raw = parsed.searchParams.get("tabId");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function buildPanelUrl(panelBase: string, targetTabId: number): string {
  const url = new URL(panelBase);
  url.searchParams.set("tabId", String(targetTabId));
  return url.toString();
}

export interface TabSwitch {
  prevTabId: number | null;
  nextTabId: number;
  /** prev/next가 BugShot 패널 탭이면 그 대상 tabId, 아니면 null */
  prevPanelTarget: number | null;
  nextPanelTarget: number | null;
}

/** 정지할 탭 id 목록. 기존 "prev를 정지"에 자기 패널 예외만 더한다.
 *  prev=T, next=T의 패널 (nextPanelTarget===prev) → []   (자기 패널로 이동: 기록 유지)
 *  prev=T의 패널, next=T (prevPanelTarget===next) → []   (돌아옴: 아직 돌고 있음)
 *  prev=T의 패널, next=X(≠T)                       → [prev] (패널 id라 no-op — T 계속 기록, 현재 동작과 같음)
 *  prev=P(일반), next≠P                            → [P]  (기존 동작)
 *  prev null 또는 prev===next                       → [] */
export function recordersToStopOnSwitch(s: TabSwitch): number[] {
  if (s.prevTabId == null || s.prevTabId === s.nextTabId) return [];
  if (s.nextPanelTarget === s.prevTabId) return [];
  if (s.prevPanelTarget === s.nextTabId) return [];
  return [s.prevTabId];
}
