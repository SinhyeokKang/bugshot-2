/**
 * 디바이스 뷰포트 모드의 전이 판정과, 전이를 넘어 살아남아야 하는 최소 상태.
 *
 * **pending과 루프 카운터가 훅이 아니라 여기 모듈 스코프에 있는 이유**: `useDeviceViewport`는
 * `DeviceViewportBar`와 `App.tsx`의 다이얼로그 분기에서 **두 번 마운트된다.** 훅 상태에 두면
 * 인스턴스마다 pending을 갖게 되어 top 커밋 한 번에 재수립이 2회 발사되고 루프 임계를 각각
 * 절반씩 센다 — "호출 지점 2개 고정"이 인스턴스 축에서 깨진다.
 *
 * **pending은 인메모리다.** 개요의 "상태를 어디에 두지 않을 것인가"와 표면상 충돌하므로 세
 * 조건을 명시한다: ① chrome.storage에 영속하지 않는다 ② 매 top 커밋마다 실제 re-mount로
 * 조정된다 ③ 차단되면 `전체`로 롤백된다. 이 셋이 깨지면 기각했던 desync(래퍼는 없는데
 * UI만 ON)가 되살아난다.
 */

export type SelectPath = "off-to-on" | "resize" | "on-to-off" | "noop";

/**
 * `select()`의 세 경로. **폭 갱신에 device.arm·frameLoaded 대기·레코더 전환·로그 clear를
 * 붙이면 안 된다** — 재로드가 없으니 frameReady도 onCommitted도 오지 않고 3초 무신호 →
 * 차단 판정 → 롤백으로 끝난다(390에서 768을 누르면 모드가 통째로 풀리는 증상).
 */
export function resolveSelectPath(
  current: number | null,
  next: number | null,
): SelectPath {
  if (current === next) return "noop";
  if (next === null) return "on-to-off";
  if (current === null) return "off-to-on";
  return "resize";
}

export type ReestablishVerdict =
  | { action: "run" }
  | { action: "reject"; reason: "busy"; restorePending: true }
  | { action: "abandon"; reason: "unsupported" | "loop" };

/**
 * 재수립은 사용자 조작이 아니라 "이미 벌어진 페이지 사실"에 대한 반응이다.
 *
 * - **phase 축은 우회한다.** `select()`의 잠금은 사용자가 전환을 일으켜 draft·선택 요소·녹화를
 *   깨는 것을 막는 장치다. 재수립에 그대로 적용하면 drafting·recording 중 handoff에서 top만
 *   옮겨가고 래퍼가 안 서는데 세그먼트는 여전히 폭을 가리키는 desync가 된다.
 * - **unsupported 축은 우회하지 않는다.** locked가 두 축이라 뭉뚱그리면 미지원 URL에서도
 *   재수립을 시도하게 되고 폐기 조건 "미지원 URL 도달"과 충돌한다.
 * - **busy 거부는 실패가 아니다.** 소비한 pending을 되돌려놓지 않으면 `select()`가 도는 중에
 *   온 top 커밋에서 모드가 조용히 유실된다.
 */
export function decideReestablish(input: {
  phase: string;
  unsupported: boolean;
  busy: boolean;
  loop: boolean;
}): ReestablishVerdict {
  if (input.unsupported) return { action: "abandon", reason: "unsupported" };
  if (input.loop) return { action: "abandon", reason: "loop" };
  if (input.busy) return { action: "reject", reason: "busy", restorePending: true };
  return { action: "run" };
}

/* ── pending ────────────────────────────────────────────────── */

export interface Pending {
  tabId: number;
  width: number;
}

const pendingByTab = new Map<number, Pending>();

export function putPending(tabId: number, width: number): void {
  pendingByTab.set(tabId, { tabId, width });
}

export function peekPending(tabId: number): Pending | null {
  return pendingByTab.get(tabId) ?? null;
}

/** top 커밋에서의 소비. 실패 경로에 유령 pending이 안 남게 읽는 즉시 지운다. */
export function takePending(tabId: number): Pending | null {
  const pending = pendingByTab.get(tabId) ?? null;
  pendingByTab.delete(tabId);
  return pending;
}

export function dropPending(tabId: number): void {
  pendingByTab.delete(tabId);
}

/* ── 루프 가드 ──────────────────────────────────────────────── */

/** 재수립 성공 후 top 커밋 없이 이만큼 지나면 카운터를 0으로 되돌린다. */
export const LOOP_RESET_MS = 10_000;

const LOOP_LIMIT = 2;

interface LoopSlot {
  count: number;
  lastUrl: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const loopByTab = new Map<number, LoopSlot>();

/**
 * **handoff가 아니라 재수립을 센다.** handoff 횟수만 세면 a→b→a 핑퐁은 잡지만 frame-busting은
 * 못 잡는다 — 래퍼가 `window.top.location = self.location`으로 탈출하면 handoff를 거치지 않고
 * top이 곧장 커밋되고, 재수립된 래퍼가 또 탈출해 무한 재로드가 된다. 카운터를 이 호출에 걸면
 * 두 경로가 한 그물에 들어온다.
 */
export function noteReestablish(tabId: number, url: string): "ok" | "loop" {
  const slot = loopByTab.get(tabId) ?? { count: 0, lastUrl: "", timer: null };
  if (slot.timer) clearTimeout(slot.timer);
  const revisit = slot.count > 0 && slot.lastUrl === url;
  slot.count += 1;
  slot.lastUrl = url;
  slot.timer = setTimeout(() => resetLoopGuard(tabId), LOOP_RESET_MS);
  loopByTab.set(tabId, slot);
  return revisit || slot.count > LOOP_LIMIT ? "loop" : "ok";
}

/** 사용자의 명시적 세그먼트 조작이 "정상 사용 중" 신호다. */
export function resetLoopGuard(tabId: number): void {
  const slot = loopByTab.get(tabId);
  if (slot?.timer) clearTimeout(slot.timer);
  loopByTab.delete(tabId);
}

/** 테스트·탭 정리용 전량 초기화. */
export function clearDeviceModeState(): void {
  pendingByTab.clear();
  for (const slot of loopByTab.values()) {
    if (slot.timer) clearTimeout(slot.timer);
  }
  loopByTab.clear();
}
