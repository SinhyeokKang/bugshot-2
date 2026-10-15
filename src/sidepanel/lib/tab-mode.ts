import { parsePanelTabTarget } from "@/lib/panel-tab-url";
import { isSupportedUrl } from "@/lib/url-support";
import type { EditorPhase } from "@/store/editor-store";

export interface TabLike {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  title?: string;
}

/** self=null(사이드패널) → false. 다른 창 → false. 같은 창 && target 비활성 → true. */
export function shouldActivateTarget(a: { self: TabLike | null; target: TabLike }): boolean {
  const { self, target } = a;
  if (!self || self.windowId == null || target.windowId == null) return false;
  if (self.id === target.id) return false;
  return self.windowId === target.windowId && !target.active;
}

/** target 없음(닫힘) → false. target 비활성(사용자가 제3 탭으로 감) → false. */
export function shouldRestorePanel(a: { target: TabLike | null }): boolean {
  return !!a.target?.active;
}

// area는 사용자가 직접 대상 탭으로 가서 드래그한 캡처 — 활성화는 안 하지만 끝나면 패널로 돌아온다.
export type HoldReason = "picking" | "inline" | "viewport" | "capture" | "area";

/** 상태 기반 hold. viewport/capture/area는 호출부가 명시적으로 잡는다. */
export function targetHoldFromState(s: { phase: EditorPhase; inline: boolean }): {
  picking: boolean;
  inline: boolean;
} {
  return { picking: s.phase === "picking", inline: s.inline };
}

/** self 제외, isSupportedUrl 통과, 모든 창, 같은 창 먼저(각 그룹 안에선 원래 순서 유지) */
export function listTargetCandidates<T extends TabLike>(
  tabs: T[],
  self: { id: number; windowId: number },
): T[] {
  const eligible = tabs.filter((t) => t.id != null && t.id !== self.id && isSupportedUrl(t.url));
  return [
    ...eligible.filter((t) => t.windowId === self.windowId),
    ...eligible.filter((t) => t.windowId !== self.windowId),
  ];
}

export type TabModeGate = "pending" | "sidepanel" | "pick" | "bound";

/** App 렌더 분기. 판정이 의미 있는 건 ?tabId=가 없을 때뿐이다 — 정수 쿼리가 있으면 사이드패널이든 탭 모드든
 *  결과가 같으므로 getSelfTab을 기다리지 않고 bound(사이드패널 정상 경로를 새 비동기 게이트 뒤로 세우지 않는다).
 *  쿼리가 정수가 아니면 useBoundTabId는 폴백이 임의 탭을 주고 `Number.isFinite`라 1.5도 받으므로 판정은 이 파서
 *  (정수만)로만 한다. self=undefined는 getSelfTab 대기 중. */
export function tabModeGate(a: {
  self: { id: number } | null | undefined;
  href: string;
  panelBase: string;
}): TabModeGate {
  if (parsePanelTabTarget(a.href, a.panelBase) !== null) return "bound";
  if (a.self === undefined) return "pending";
  if (a.self === null) return "sidepanel";
  return "pick";
}
