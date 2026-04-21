import { useMemo } from "react";

export function useBoundTabId(): number | null {
  return useMemo(() => {
    const raw = new URL(window.location.href).searchParams.get("tabId");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, []);
}
