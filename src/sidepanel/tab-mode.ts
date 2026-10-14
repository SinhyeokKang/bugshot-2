import {
  shouldActivateTarget,
  shouldRestorePanel,
  type HoldReason,
  type TabLike,
} from "./lib/tab-mode";

// 패널을 일반 탭으로 연 "탭 모드"에서 대상 탭이 앞에 있어야 하는 구간을 단일 refcount로 소유한다.
// 사이드패널은 getCurrent()가 undefined라 전부 no-op이다.

// 숨은 패널은 타이머가 1s 단위로 정렬된다 — 상한은 그보다 넉넉히. 확정이 안 와도 진행하고
// 관문(captureOwnedTab)이 거부하면 실패 토스트로 드러난다.
const ACTIVATION_WAIT_MS = 1500;

let selfTab: Promise<{ id: number } | null> | null = null;
let count = 0;
let activatedByUs = false;
// 활성화·복원 단계를 직렬화한다 — 늦게 끝난 복원이 새 hold의 활성화를 덮지 않게.
let chain: Promise<void> = Promise.resolve();

// id만 캐시한다. getCurrent()는 url이 없고, windowId는 창 이동 뒤 stale이라 매번 다시 조회한다.
export function getSelfTab(): Promise<{ id: number } | null> {
  selfTab ??= (async () => {
    try {
      const tab = await chrome.tabs.getCurrent();
      return typeof tab?.id === "number" ? { id: tab.id } : null;
    } catch {
      return null;
    }
  })();
  return selfTab;
}

export async function focusTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
}

async function getTab(tabId: number): Promise<TabLike | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function enqueue(step: () => Promise<void>): void {
  chain = chain.then(() => step().catch(() => {}));
}

// 확정은 update 반환값 또는 onActivated로만 — 숨은 패널에서 tabs.get 폴링은 throttle에 걸린다.
async function activateAndConfirm(tabId: number): Promise<void> {
  let settle = () => {};
  const confirmed = new Promise<void>((resolve) => {
    const onActivated = (info: { tabId: number }) => {
      if (info.tabId === tabId) settle();
    };
    const timer = setTimeout(() => settle(), ACTIVATION_WAIT_MS);
    settle = () => {
      clearTimeout(timer);
      chrome.tabs.onActivated.removeListener(onActivated);
      resolve();
    };
    chrome.tabs.onActivated.addListener(onActivated);
  });
  const updated = await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  if (updated?.active) settle();
  await confirmed;
}

async function activate(targetTabId: number, reason: HoldReason): Promise<void> {
  if (count === 0) return;
  const self = await getSelfTab();
  if (!self) return;
  const [selfNow, target] = await Promise.all([getTab(self.id), getTab(targetTabId)]);
  if (!selfNow || !target) return;
  if (shouldActivateTarget({ self: selfNow, target })) {
    activatedByUs = true;
    await activateAndConfirm(targetTabId);
  } else if (reason === "area" && target.active && selfNow.windowId === target.windowId) {
    activatedByUs = true;
  }
}

async function restore(targetTabId: number): Promise<void> {
  if (count !== 0 || !activatedByUs) return;
  const self = await getSelfTab();
  const target = await getTab(targetTabId);
  // 조회하는 사이 새 hold가 왔으면 그 hold가 이어받는다.
  if (count !== 0) return;
  activatedByUs = false;
  if (!self || !shouldRestorePanel({ target })) return;
  await focusTab(self.id);
}

export function holdTarget(
  targetTabId: number,
  reason: HoldReason,
): Promise<() => Promise<void>> {
  // count는 동기로 올린다 — before hold가 같은 태스크의 styling 전이(picking release)보다 먼저 잡혀야 한다.
  count += 1;
  if (count === 1) enqueue(() => activate(targetTabId, reason));
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    count -= 1;
    if (count === 0) enqueue(() => restore(targetTabId));
    await chain;
  };
  return chain.then(() => release);
}

export async function withTargetHold<T>(
  targetTabId: number,
  run: () => Promise<T>,
  reason: HoldReason = "capture",
): Promise<T> {
  const release = await holdTarget(targetTabId, reason);
  try {
    return await run();
  } finally {
    await release();
  }
}
