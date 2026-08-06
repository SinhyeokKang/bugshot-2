import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { useUnsupportedTab } from "@/sidepanel/hooks/tab-support-context";
import {
  selectDeviceWidth,
  useDeviceViewportStore,
  watchAvailableWidth,
} from "@/sidepanel/device-viewport-controller";
import { isDeviceModeLocked } from "@/sidepanel/lib/device-mode";

export interface DeviceViewportState {
  /** 현재 폭. null = 전체. 단일 출처는 페이지 DOM이고 chrome.storage에 영속하지 않는다. */
  width: number | null;
  availableWidth: number | null;
  locked: boolean;
  busy: boolean;
  select: (width: number | null) => Promise<void>;
}

/**
 * 세그먼트 컨트롤의 구독 훅. **오케스트레이션은 여기 없다** — push 리스너는 패널 루트가
 * 소유해야 `hideSubTabs` 구간(작성 중 handoff)에서도 살아남는다. 이 훅이 여는 건 화면에
 * 보이는 동안만 필요한 가용 폭 구독뿐이다.
 */
export function useDeviceViewport(tabId: number | null): DeviceViewportState {
  const unsupported = useUnsupportedTab();
  const phase = useEditorStore((s) => s.phase);
  const width = useDeviceViewportStore((s) => s.width);
  const availableWidth = useDeviceViewportStore((s) => s.availableWidth);
  const busy = useDeviceViewportStore((s) => s.busy);

  useEffect(() => {
    if (tabId == null) return;
    return watchAvailableWidth(tabId);
  }, [tabId]);

  return {
    width,
    availableWidth,
    locked: isDeviceModeLocked(phase, unsupported),
    busy,
    select: selectDeviceWidth,
  };
}
