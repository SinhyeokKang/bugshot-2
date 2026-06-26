import { useEffect, useRef } from "react";

export function useScrollToEntry(opts: {
  scrollToEntryId: string | null | undefined;
  getListViewport: () => HTMLElement | null;
  filteredItems: unknown[];
  resetFilters: () => void;
  // 디바운스된 검색 필터가 정착됐는지(즉시값 == 디바운스값). false면 목록이 곧 갱신되므로 포기를 미룬다.
  searchSettled?: boolean;
  onScrollComplete?: () => void;
  onFound?: () => void;
}): void {
  const { scrollToEntryId, getListViewport, filteredItems, resetFilters, searchSettled = true, onScrollComplete, onFound } = opts;
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
    if (!searchSettled) return;
    onScrollComplete?.();
    scrollResetRef.current = false;
  }, [scrollToEntryId, filteredItems, searchSettled, getListViewport, onScrollComplete]);
}
