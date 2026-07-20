import { useEffect, useState } from "react";

// activeKey가 truthy인 동안 intervalMs마다 step을 1씩 올린다.
// activeKey가 바뀌거나 null이 되면 0으로 리셋 — 오버레이 문구 로테이션 + ripple replay 트리거 용도.
export function useAiLoadingStep(
  activeKey: string | null,
  intervalMs = 2000,
): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    if (!activeKey) return;
    const id = window.setInterval(() => setStep((s) => s + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [activeKey, intervalMs]);
  return step;
}
