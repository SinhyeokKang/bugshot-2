import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { useUnsupportedTab } from "@/sidepanel/hooks/tab-support-context";
import {
  attachDeviceViewport,
  selectDeviceWidth,
  setDeviceViewportUnsupported,
  useDeviceViewportStore,
} from "@/sidepanel/device-viewport-controller";

export interface DeviceViewportState {
  /** 현재 폭. null = 전체. 단일 출처는 페이지 DOM이고 chrome.storage에 영속하지 않는다. */
  width: number | null;
  availableWidth: number | null;
  /**
   * 미지원 탭은 행 자체가 미렌더라 이 축에 안 걸리지만, App.tsx의 다이얼로그 분기가 같은 훅을
   * 쓰므로 unsupported도 함께 잠근다. 재수립은 phase 축만 우회하고 unsupported는 폐기한다.
   */
  locked: boolean;
  busy: boolean;
  select: (width: number | null) => Promise<void>;
}

/**
 * 오케스트레이션은 모듈 스코프 컨트롤러가 소유하고 이 훅은 구독만 한다 — 훅이 두 곳
 * (`DeviceViewportBar`·`App.tsx` 다이얼로그 분기)에서 마운트되기 때문이다.
 */
export function useDeviceViewport(tabId: number | null): DeviceViewportState {
  const unsupported = useUnsupportedTab();
  const phase = useEditorStore((s) => s.phase);
  const width = useDeviceViewportStore((s) => s.width);
  const availableWidth = useDeviceViewportStore((s) => s.availableWidth);
  const busy = useDeviceViewportStore((s) => s.busy);

  useEffect(() => {
    setDeviceViewportUnsupported(unsupported);
  }, [unsupported]);

  useEffect(() => {
    if (tabId == null) return;
    return attachDeviceViewport(tabId);
  }, [tabId]);

  return {
    width,
    availableWidth,
    locked: phase !== "idle" || unsupported,
    busy,
    select: selectDeviceWidth,
  };
}
