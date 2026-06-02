import { useEffect, useRef } from "react";

export function useScrollToEntry(opts: {
  scrollToEntryId: string | null | undefined;
  getListViewport: () => HTMLElement | null;
  filteredItems: unknown[];
  resetFilters: () => void;
  onScrollComplete?: () => void;
  onFound?: () => void;
}): void {
  const { scrollToEntryId, getListViewport, filteredItems, resetFilters, onScrollComplete, onFound } = opts;
  const scrollResetRef = useRef(false);
  useEffect(() => {
    if (!scrollToEntryId) { scrollResetRef.current = false; return; }
    const vp = getListViewport();
    if (!vp) { onScrollComplete?.(); return; }
    const el = vp.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(scrollToEntryId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      onFound?.();
      onScrollComplete?.();
      scrollResetRef.current = false;
      return;
    }
    if (!scrollResetRef.current) {
      scrollResetRef.current = true;
      resetFilters();
      return;
    }
    onScrollComplete?.();
    scrollResetRef.current = false;
  }, [scrollToEntryId, filteredItems, getListViewport, onScrollComplete]);
}
