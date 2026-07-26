// Chrome은 captureVisibleTab을 MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND(2회/초)로 제한한다.
// 캡처 호출처가 여럿(30s 리플레이 폴링 + 엘리먼트 스냅샷 + 스타일 before/after)이라 동시에
// 터지면 쿼터를 넘는다. 모든 캡처를 한 큐로 직렬화하고 호출 간 최소 간격을 둬 한계 아래로
// 유지하며, 그래도 걸리면 rate-limit 에러에 한해 백오프 재시도한다.

export const CAPTURE_MIN_GAP_MS = 500;
export const CAPTURE_RETRY_DELAYS_MS = [550, 700, 900];

export function isCaptureRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(msg);
}

export interface ThrottleDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: ThrottleDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function createCaptureThrottle(deps: ThrottleDeps = realDeps) {
  let chain: Promise<unknown> = Promise.resolve();
  let lastAt = -Infinity;

  function run<T>(capture: () => Promise<T>): Promise<T> {
    const result = chain.then(async () => {
      const wait = CAPTURE_MIN_GAP_MS - (deps.now() - lastAt);
      if (wait > 0) await deps.sleep(wait);

      for (let attempt = 0; ; attempt++) {
        try {
          return await capture();
        } catch (err) {
          const lastAttempt = attempt >= CAPTURE_RETRY_DELAYS_MS.length;
          if (!isCaptureRateLimitError(err) || lastAttempt) throw err;
          await deps.sleep(CAPTURE_RETRY_DELAYS_MS[attempt]);
        } finally {
          lastAt = deps.now();
        }
      }
    });
    // 한 캡처가 실패해도 큐의 다음 작업은 진행하도록 체인 에러를 흡수한다.
    chain = result.catch(() => {});
    return result;
  }

  return { run };
}

export const captureThrottle = createCaptureThrottle();

export interface CaptureOwnerDeps {
  getTab: (tabId: number) => Promise<{ active?: boolean; windowId?: number }>;
  captureVisibleTab: (
    windowId: number,
    opts: chrome.tabs.CaptureVisibleTabOptions,
  ) => Promise<string>;
}

const realOwnerDeps: CaptureOwnerDeps = {
  getTab: (tabId) => chrome.tabs.get(tabId),
  captureVisibleTab: (windowId, opts) =>
    chrome.tabs.captureVisibleTab(windowId, opts),
};

// captureVisibleTab은 탭이 아니라 "그 창에서 지금 보이는 탭"을 찍는다. 큐 대기(최대 ~2.6s)
// 동안 사용자가 탭을 바꿨으면 남의 페이지를 찍게 되므로, 소유권 확인은 반드시 run() 콜백
// 안에서 — 대기가 끝난 뒤에 — 해야 한다.
export async function captureOwnedTab(
  tabId: number,
  opts: chrome.tabs.CaptureVisibleTabOptions,
  deps: CaptureOwnerDeps = realOwnerDeps,
): Promise<string> {
  const tab = await deps.getTab(tabId);
  if (!tab.windowId) throw new Error("tab has no window");
  if (!tab.active) throw new Error(`tab ${tabId} is no longer the active tab`);
  return deps.captureVisibleTab(tab.windowId, opts);
}
