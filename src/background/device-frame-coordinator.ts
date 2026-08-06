import type { BgInternalMessage, DeviceDocumentsResponse } from "@/types/messages";

export interface DeviceFrameBinding {
  frameId: number;
  documentId: string;
}

export interface DeviceFrameState {
  /** 판정 기준 URL. 래퍼는 언제나 top과 same-origin이라는 불변식의 대조 대상이다. */
  topUrl: string;
  /** 래퍼 커밋 감시창이 열려 있는가. 잠정 등록과 진입 판정이 이 창 안에서만 일어난다. */
  armed: boolean;
  /**
   * 즉시 redirect돼 device.frameReady가 안 오는 사이트에서 래퍼 frameId를 아는 유일한
   * 시작점 — 성공·차단·handoff 세 판정의 공통 타깃이다.
   */
  provisionalFrameId: number | null;
  binding: DeviceFrameBinding | null;
}

export type DeviceSignal =
  | { kind: "frameReady"; frameId: number; documentId: string }
  | { kind: "beforeNavigate"; frameId: number; parentFrameId: number; url: string }
  | { kind: "committed"; frameId: number; documentId: string; url: string }
  | { kind: "errorOccurred"; frameId: number; url: string }
  // top의 iframe "load". 보조 신호이고 단독으로 성공을 선언하지 않는다.
  | { kind: "frameLoadEvent"; sameOriginHref: string | null }
  | { kind: "armTimeout" };

export type DevicePush =
  | { type: "frameLoaded" }
  | { type: "frameBlocked" }
  | { type: "handoff"; url: string };

export interface DeviceDecision {
  push: DevicePush | null;
  next: DeviceFrameState;
}

export const ARM_WINDOW_MS = 3000;

const STORAGE_PREFIX = "deviceFrame:";

function storageKey(tabId: number): string {
  return `${STORAGE_PREFIX}${tabId}`;
}

// 판정 기준은 site가 아니라 origin이다 — a.com → www.a.com은 same-site여도 frameElement가
// null이 되고 pre-arm 플래그(origin 스코프 sessionStorage)가 갈려, same-origin 전제로 싸게
// 만든 배선 셋(래퍼 자가 식별·pre-arm 버퍼링·element 컨텍스트 확장)이 한꺼번에 무너진다.
function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function targetFrameId(state: DeviceFrameState): number | null {
  return state.binding?.frameId ?? state.provisionalFrameId;
}

/**
 * 신호 하나 → push 0 또는 1. 성공·차단·handoff가 절대 경쟁하지 않게 이 함수가 유일한 판정처다.
 * content가 contentDocument.location.href를 비교해 스스로 롤백하면 정상 redirect를 차단으로
 * 오판하고, 다른 origin으로 밀린 문서는 DOM으로 들여다볼 수조차 없다.
 */
export function decideDeviceSignal(
  state: DeviceFrameState,
  signal: DeviceSignal,
): DeviceDecision {
  const target = targetFrameId(state);

  switch (signal.kind) {
    case "frameReady": {
      const binding = { frameId: signal.frameId, documentId: signal.documentId };
      // frameReady는 한 번만 오지 않는다 — same-origin 불변식 때문에 래퍼 안에서 링크를 타고
      // 들어간 후속 문서도 frameElement를 읽어 매번 재발화한다. arm 창이 닫혀 있으면
      // documentId만 갱신한다(안 막으면 이동마다 전이 완료 처리가 반복된다).
      if (!state.armed) return { push: null, next: { ...state, binding } };
      return {
        push: { type: "frameLoaded" },
        next: { ...state, armed: false, provisionalFrameId: null, binding },
      };
    }

    case "beforeNavigate": {
      if (target != null && signal.frameId === target) {
        // commit에서 잡으면 파티션된 로그아웃 화면이 이미 렌더되고 그 문서의 로그·요청이
        // 수집된 뒤다. 요청 전에 잡는 이 경로가 1차 트리거다.
        if (!isSameOrigin(signal.url, state.topUrl)) {
          return {
            push: { type: "handoff", url: signal.url },
            next: { ...state, armed: false },
          };
        }
        return { push: null, next: state };
      }
      const canGuess =
        state.armed &&
        state.binding === null &&
        state.provisionalFrameId === null &&
        signal.parentFrameId === 0 &&
        signal.url === state.topUrl;
      if (!canGuess) return { push: null, next: state };
      return { push: null, next: { ...state, provisionalFrameId: signal.frameId } };
    }

    case "committed": {
      if (target == null || signal.frameId !== target) return { push: null, next: state };
      // same-origin URL이 서버에서 302로 cross-origin에 밀린 경우의 폴백.
      if (!isSameOrigin(signal.url, state.topUrl)) {
        return {
          push: { type: "handoff", url: signal.url },
          next: { ...state, armed: false },
        };
      }
      const binding = { frameId: signal.frameId, documentId: signal.documentId };
      if (!state.armed) return { push: null, next: { ...state, binding } };
      // 경로·쿼리만 바뀐 redirect도 성공이다 — 차단으로 합치지 않는다.
      return {
        push: { type: "frameLoaded" },
        next: { ...state, armed: false, provisionalFrameId: null, binding },
      };
    }

    case "errorOccurred": {
      if (target == null || signal.frameId !== target) return { push: null, next: state };
      if (state.armed) {
        return { push: { type: "frameBlocked" }, next: { ...state, armed: false } };
      }
      // 감시창 밖 차단(유지 중 XFO 사이트 도달)은 handoff와 같은 경로로 보낸다 — 프레임에
      // 못 들어가는 URL이므로 top을 그리로 내보낸다. 안 하면 백지에 방치된다.
      return { push: { type: "handoff", url: signal.url }, next: state };
    }

    case "frameLoadEvent": {
      // CSP `frame-src`가 프레임 삽입 자체를 막으면 webNavigation 이벤트가 하나도 오지 않고
      // 브라우저가 about:blank에 load만 쏜다 — 이 경우 3초 타임아웃 말고는 신호가 없다.
      // 성공 경로에서는 onCommitted가 이미 binding을 세운 뒤라 여기 도달하지 않는다.
      if (!state.armed || state.binding !== null) return { push: null, next: state };
      if (signal.sameOriginHref === null || signal.sameOriginHref === state.topUrl) {
        return { push: null, next: state };
      }
      return { push: { type: "frameBlocked" }, next: { ...state, armed: false } };
    }

    case "armTimeout":
      if (!state.armed) return { push: null, next: state };
      return { push: { type: "frameBlocked" }, next: { ...state, armed: false } };

    default:
      signal satisfies never;
      return { push: null, next: state };
  }
}

/**
 * 0 || 래퍼. **동기다** — 소비처가 리스너 최상단이기 때문이고, 대신 호출 전에 복원이 끝나
 * 있음을 탭별 순서 큐가 보장한다. 큐 밖에서 부르면 복원 전 오판이 된다.
 */
export function isTopLikeFrame(
  binding: DeviceFrameBinding | null,
  frameId: number,
): boolean {
  return frameId === 0 || (binding != null && binding.frameId === frameId);
}

/** getAllFrames + binding을 합쳐 전 document와 래퍼 서브트리를 가른다. */
export function splitTabDocuments(
  frames: Array<{ frameId: number; parentFrameId: number; documentId?: string }>,
  binding: DeviceFrameBinding | null,
): DeviceDocumentsResponse {
  const all = frames
    .map((f) => f.documentId)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
  if (!binding) return { all, deviceTree: [] };

  const inTree = new Set<number>([binding.frameId]);
  // 계보는 깊이를 모르므로 고정점까지 돈다(프레임 수가 수십 단위라 비용이 무의미하다).
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of frames) {
      if (!inTree.has(f.frameId) && inTree.has(f.parentFrameId)) {
        inTree.add(f.frameId);
        changed = true;
      }
    }
  }
  const deviceTree = frames
    .filter((f) => inTree.has(f.frameId))
    .map((f) => f.documentId)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
  return { all, deviceTree };
}

/* ── 탭별 상태 · storage 복원 · 순서 큐 ────────────────────────────── */

const bindingByTab = new Map<number, DeviceFrameBinding>();
const armedByTab = new Map<number, { armed: boolean; provisionalFrameId: number | null; topUrl: string }>();
const restoreByTab = new Map<number, Promise<void>>();
const queueByTab = new Map<number, Promise<unknown>>();
const armTimers = new Map<number, ReturnType<typeof setTimeout>>();
// navUrlPromise를 tabId:frameId로 넓히면서 래퍼의 prev URL은 tabs.get이 아니라 직전
// onCommitted URL로 추적해야 한다 — top URL은 래퍼가 움직여도 안 바뀐다.
const lastCommittedUrl = new Map<string, string>();

function ensureRestored(tabId: number): Promise<void> {
  let p = restoreByTab.get(tabId);
  if (p) return p;
  p = chrome.storage.session
    .get(storageKey(tabId))
    .then((data) => {
      const stored = data[storageKey(tabId)] as DeviceFrameBinding | undefined;
      if (stored && !bindingByTab.has(tabId)) bindingByTab.set(tabId, stored);
    })
    .catch(() => {});
  restoreByTab.set(tabId, p);
  return p;
}

/**
 * 탭별 순서 큐. storage 복구와 각 navigation 처리를 같은 chain에 연결해, 복구 전 이벤트를
 * 동기 기본값으로 판정하지 않게 한다. 즉시성보다 SW 재기동 뒤의 올바른 래퍼 판정이 우선이다.
 */
export function enqueueForTab<T>(tabId: number, task: () => T | Promise<T>): Promise<T> {
  const prev = queueByTab.get(tabId) ?? ensureRestored(tabId);
  const next = prev.then(() => task());
  queueByTab.set(
    tabId,
    next.catch(() => {}),
  );
  return next;
}

export function getDeviceFrame(tabId: number): DeviceFrameBinding | null {
  return bindingByTab.get(tabId) ?? null;
}

export async function setDeviceFrame(
  tabId: number,
  binding: DeviceFrameBinding | null,
): Promise<void> {
  // 권위값은 storage.session이고 Map은 복제 캐시다. 복원을 건너뛰어도 되는 상태가 되므로
  // restore 슬롯을 즉시 resolved로 덮어 다음 큐가 불필요하게 storage를 다시 읽지 않게 한다.
  restoreByTab.set(tabId, Promise.resolve());
  if (binding) {
    bindingByTab.set(tabId, binding);
    await chrome.storage.session.set({ [storageKey(tabId)]: binding });
    return;
  }
  bindingByTab.delete(tabId);
  await chrome.storage.session.remove(storageKey(tabId));
}

function armSlot(tabId: number): { armed: boolean; provisionalFrameId: number | null; topUrl: string } {
  let slot = armedByTab.get(tabId);
  if (!slot) {
    slot = { armed: false, provisionalFrameId: null, topUrl: "" };
    armedByTab.set(tabId, slot);
  }
  return slot;
}

export function readDeviceState(tabId: number): DeviceFrameState {
  const slot = armSlot(tabId);
  return {
    topUrl: slot.topUrl,
    armed: slot.armed,
    provisionalFrameId: slot.provisionalFrameId,
    binding: getDeviceFrame(tabId),
  };
}

function pushToPanel(message: BgInternalMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

/** 신호를 상태에 반영하고 결과를 사이드패널에 push한다. 반드시 큐 안에서 부른다. */
export async function applyDeviceSignal(
  tabId: number,
  signal: DeviceSignal,
): Promise<DevicePush | null> {
  const { push, next } = decideDeviceSignal(readDeviceState(tabId), signal);
  const slot = armSlot(tabId);
  slot.armed = next.armed;
  slot.provisionalFrameId = next.provisionalFrameId;
  if (next.armed === false) clearArmTimer(tabId);
  const prevBinding = getDeviceFrame(tabId);
  if (
    next.binding &&
    (prevBinding?.frameId !== next.binding.frameId ||
      prevBinding?.documentId !== next.binding.documentId)
  ) {
    await setDeviceFrame(tabId, next.binding);
  }
  if (!push) return null;
  if (push.type === "handoff") {
    pushToPanel({ type: "device.handoff", tabId, url: push.url });
  } else if (push.type === "frameLoaded") {
    // frameId는 방금 확정한 binding에서 나온다 — 사이드패널이 picker.start 재전송에 쓴다.
    pushToPanel({ type: "device.frameLoaded", tabId, frameId: next.binding?.frameId ?? 0 });
  } else {
    pushToPanel({ type: "device.frameBlocked", tabId });
  }
  return push;
}

function clearArmTimer(tabId: number): void {
  const timer = armTimers.get(tabId);
  if (timer == null) return;
  clearTimeout(timer);
  armTimers.delete(tabId);
}

/** 래퍼 커밋 감시창(3s) 개폐. device.set보다 먼저 열어야 첫 onBeforeNavigate를 안 놓친다. */
export function armDeviceFrame(tabId: number, on: boolean, topUrl: string): void {
  clearArmTimer(tabId);
  const slot = armSlot(tabId);
  slot.armed = on;
  slot.provisionalFrameId = null;
  if (topUrl) slot.topUrl = topUrl;
  if (!on) return;
  armTimers.set(
    tabId,
    setTimeout(() => {
      armTimers.delete(tabId);
      void enqueueForTab(tabId, () => applyDeviceSignal(tabId, { kind: "armTimeout" }));
    }, ARM_WINDOW_MS),
  );
}

/** device.documents의 구현. Task 5 게이트의 유일한 문서 열거원이다. */
export async function listTabDocuments(tabId: number): Promise<DeviceDocumentsResponse> {
  return enqueueForTab(tabId, async () => {
    let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null = null;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch {
      frames = null;
    }
    if (!frames) return { all: [], deviceTree: [] };
    return splitTabDocuments(
      frames.map((f) => ({
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        documentId: f.documentId,
      })),
      getDeviceFrame(tabId),
    );
  });
}

/** 래퍼가 이동해도 top URL은 안 바뀌므로 프레임별 직전 커밋 URL을 따로 추적한다. */
export function trackCommittedUrl(tabId: number, frameId: number, url: string): string {
  const key = `${tabId}:${frameId}`;
  const prev = lastCommittedUrl.get(key) ?? "";
  lastCommittedUrl.set(key, url);
  return prev;
}

/** top 이동·탭 제거·명시적 OFF에서 Map·storage·타이머를 함께 지운다. */
export async function clearDeviceFrame(tabId: number): Promise<void> {
  clearArmTimer(tabId);
  armedByTab.delete(tabId);
  for (const key of [...lastCommittedUrl.keys()]) {
    if (key.startsWith(`${tabId}:`)) lastCommittedUrl.delete(key);
  }
  await setDeviceFrame(tabId, null);
}
