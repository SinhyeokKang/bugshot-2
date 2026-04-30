import { useEffect, useState } from "react";

// SidePanel은 윈도우당 1개라 lastFocusedWindow의 active tab이 곧 panel이 붙은 탭.
// `?tabId=` 쿼리 없이 default_path로 mount된 경우의 self-recover 경로.
function readQuery(): number | null {
  const raw = new URL(window.location.href).searchParams.get("tabId");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * - `number`: tabId 확정
 * - `null`: 추론 시도 후 실패 (정말 unsupported)
 * - `undefined`: 추론 진행 중 (호출부는 잠깐 흰 화면 등 로딩 처리)
 */
export function useBoundTabId(): number | null | undefined {
  const [state, setState] = useState<number | null | undefined>(() => {
    const fromQuery = readQuery();
    return fromQuery ?? undefined;
  });

  useEffect(() => {
    if (state !== undefined) return;
    let cancelled = false;
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then((tabs) => {
        if (cancelled) return;
        const id = tabs[0]?.id;
        setState(typeof id === "number" ? id : null);
      })
      .catch(() => {
        if (cancelled) return;
        setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  return state;
}
