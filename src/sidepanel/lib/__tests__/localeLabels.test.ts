import { describe, expect, it } from "vitest";
import { LOCALE_LABELS } from "../localeLabels";
import { LOCALES } from "@/i18n/locales";
import { findExtraneous, findUncovered } from "@/test/locale-parity";

// 셀렉터 옵션이 배열이면 로케일을 등록하고 사전을 다 채워도 목록에 안 뜬다 — 사용자가
// 고를 수 없는 무음 상태다. 폴백 금지 4형제와 같은 등급이라 맵으로 바꿔 컴파일이 강제하게 하고,
// 여기서 커버리지·중복까지 잡는다.

describe("LOCALE_LABELS", () => {
  it("등록된 모든 로케일이 라벨을 갖는다", () => {
    expect(findUncovered(LOCALES, LOCALE_LABELS)).toEqual([]);
  });

  it("LOCALES에 없는 라벨이 남아있지 않다 (도달 불가 옵션)", () => {
    expect(findExtraneous(LOCALES, LOCALE_LABELS)).toEqual([]);
  });

  it("빈 라벨이 없다", () => {
    const empty = Object.entries(LOCALE_LABELS)
      .filter(([, v]) => !v || !v.trim())
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  // AI_LANGUAGE_OPTIONS와 같은 컨벤션 — 셀렉터에서 모국어로 읽히게 한다.
  it("자기 언어 표기다 (현재 값 회귀 핀)", () => {
    expect(LOCALE_LABELS.ko).toBe("한국어");
    expect(LOCALE_LABELS.en).toBe("English");
  });

  // 라벨이 겹치면 셀렉터에서 두 항목을 구분할 수 없다.
  it("라벨이 서로 중복되지 않는다", () => {
    const labels = LOCALES.map((l) => LOCALE_LABELS[l]);
    expect([...new Set(labels)]).toHaveLength(labels.length);
  });
});
