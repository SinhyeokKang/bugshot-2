import { useCallback, useEffect, useRef } from "react";

export function scheduleDeferredExport(
  callback: FrameRequestCallback,
  requestFrame: typeof requestAnimationFrame = requestAnimationFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
): () => void {
  let cancelled = false;
  const frameId = requestFrame((time) => {
    if (!cancelled) callback(time);
  });
  return () => {
    cancelled = true;
    cancelFrame(frameId);
  };
}

export function useDeferredExport(
  requestFrame: typeof requestAnimationFrame = requestAnimationFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
): (callback: FrameRequestCallback) => void {
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);
  return useCallback((callback) => {
    cancelRef.current = scheduleDeferredExport(
      (time) => {
        cancelRef.current = null;
        callback(time);
      },
      requestFrame,
      cancelFrame,
    );
  }, [requestFrame, cancelFrame]);
}
