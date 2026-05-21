import { useCallback, useRef, useState } from "react";

export function useDebouncedSearch<T>(
  fetchFn: (query: string) => Promise<T[]>,
  delay = 300,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const search = useCallback(
    (query: string) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      const timer = window.setTimeout(() => {
        fetchFn(query)
          .then((list) => {
            if (seq === seqRef.current) setItems(list);
          })
          .catch((err: unknown) => {
            if (seq === seqRef.current)
              setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (seq === seqRef.current) setLoading(false);
          });
      }, delay);
      return () => window.clearTimeout(timer);
    },
    [fetchFn, delay],
  );

  return { items, loading, error, search };
}
