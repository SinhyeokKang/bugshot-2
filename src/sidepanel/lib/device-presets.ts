import { Laptop, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/ko";

export interface DevicePreset {
  /** 세그먼트의 뷰포트 폭. 라벨에 숫자로 그대로 노출된다. */
  width: number;
  labelKey: TranslationKey;
  /** 보조 기호. 폭 숫자를 대체하지 않는다 — 라벨이 접혔을 때의 표현 수단이다. */
  icon: LucideIcon;
}

// 430은 뺐다 — 390과 같은 브레이크포인트 구간이라 판정력이 거의 겹치는데 세그먼트 폭은
// 똑같이 먹는다. 3프리셋 + `전체`(Monitor, 데스크톱 뷰포트 겸용)로 4세그먼트다.
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { width: 390, labelKey: "issue.device.w390", icon: Smartphone },
  { width: 768, labelKey: "issue.device.w768", icon: Tablet },
  { width: 1024, labelKey: "issue.device.w1024", icon: Laptop },
];

/**
 * 가용 폭 안에 들어가는가. availableWidth가 null(미조회)이면 낙관적으로 true —
 * 초기 프레임에 모든 세그먼트가 흐려지는 깜빡임을 막고, 실제로 안 들어가면
 * mount 이후 device.availableChanged가 정정한다.
 */
export function isPresetAvailable(
  width: number,
  availableWidth: number | null,
): boolean {
  return availableWidth == null || width <= availableWidth;
}
