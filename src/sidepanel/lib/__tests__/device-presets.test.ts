import { describe, expect, it } from "vitest";
import { DEVICE_PRESETS, isPresetAvailable } from "../device-presets";

describe("device-presets", () => {
  describe("isPresetAvailable", () => {
    it("가용 폭 안에 들면 true", () => {
      expect(isPresetAvailable(390, 865)).toBe(true);
    });

    it("가용 폭을 넘으면 false", () => {
      expect(isPresetAvailable(1024, 865)).toBe(false);
    });

    it("가용 폭과 딱 같으면 true (경계 포함)", () => {
      expect(isPresetAvailable(1024, 1024)).toBe(true);
    });

    // 미조회 상태에서 전 세그먼트가 흐려지는 깜빡임을 막는다 — 실제로 안 들어가면
    // mount 이후 availableChanged가 정정한다.
    it("availableWidth가 null이면 낙관적으로 true", () => {
      expect(isPresetAvailable(1024, null)).toBe(true);
    });
  });

  describe("DEVICE_PRESETS", () => {
    it("프리셋이 3개다", () => {
      expect(DEVICE_PRESETS).toHaveLength(3);
    });

    // 430은 390과 브레이크포인트 구간이 겹쳐 판정력이 거의 같은데 세그먼트 폭은 똑같이 먹는다.
    it("430이 없고 390/768/1024다", () => {
      expect(DEVICE_PRESETS.map((p) => p.width)).toEqual([390, 768, 1024]);
    });

    // 아이콘은 좁은 폭에서 라벨이 접혔을 때의 표현 수단이지 폭 숫자의 대체가 아니다.
    it("각 프리셋에 아이콘이 있다", () => {
      for (const preset of DEVICE_PRESETS) {
        expect(preset.icon).toBeTypeOf("function");
      }
    });

    it("labelKey가 여전히 폭 숫자를 가리킨다 (아이콘이 숫자를 대체하지 않는다)", () => {
      for (const preset of DEVICE_PRESETS) {
        expect(preset.labelKey).toBe(`issue.device.w${preset.width}`);
      }
    });
  });
});
