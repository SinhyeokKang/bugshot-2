import { useEffect, useRef, useState } from "react";

const defaultFormatError = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// CcCombobox 공용: 콤보박스 open 시 목록을 1회 lazy load한다.
// load 함수의 의존성(repo·team 등 스코프)이 바뀌면 목록을 리셋하고 진행 중 응답을 무효화 —
// 늦게 도착한 이전 스코프 응답이 새 목록을 덮어쓰는 race 방지.
export function useLazyListOnOpen<T>(
  open: boolean,
  enabled: boolean,
  load: () => Promise<T[]>,
  formatError: (err: unknown) => string = defaultFormatError,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  // formatError가 렌더마다 새 함수여도(useT의 t 등) effect가 재실행되지 않도록 latest-ref로 분리.
  const formatErrorRef = useRef(formatError);
  formatErrorRef.current = formatError;

  useEffect(() => {
    reqIdRef.current++;
    setItems([]);
  }, [load]);

  useEffect(() => {
    if (!open || !enabled) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    load()
      .then((list) => {
        if (myReq !== reqIdRef.current) return;
        setItems(list);
      })
      .catch((err: unknown) => {
        if (myReq !== reqIdRef.current) return;
        setError(formatErrorRef.current(err));
      })
      .finally(() => {
        if (myReq !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [open, enabled, items.length, load]);

  return { items, loading, error };
}
