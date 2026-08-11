import { describe, expect, it } from "vitest";
import { locales } from "../index";
import { BASE_LOCALE, BCP47, DEFAULT_LOCALE, LOCALES } from "../locales";
import {
  findExtraneous,
  findParityViolations,
  findUncovered,
} from "@/test/locale-parity";

// ko/en을 하드 import해 둘씩 짝지어 비교하던 이전 버전은 3번째 로케일을 아예 안 봤다 —
// 사전을 만들지 않은 채 LOCALES에 등록만 해도 초록이었다. 레지스트리를 순회해 등록된
// 전부를 검사한다. 검사기 자체의 검증은 src/test/__tests__/locale-parity.test.ts.

describe("i18n locale parity (N-way)", () => {
  it("등록된 모든 로케일이 기준 로케일과 키·값·토큰이 대칭이다", () => {
    expect(findParityViolations(locales, BASE_LOCALE)).toEqual([]);
  });

  // `locales`는 폴백 금지 테이블이다. Partial로 바꾸면 사전 없는 로케일이 조용히
  // undefined가 되고 t()가 죽으므로, 커버리지를 여기서 강제한다.
  it("LOCALES의 모든 코드가 실제 사전을 갖는다", () => {
    expect(findUncovered(LOCALES, locales)).toEqual([]);
  });

  it("LOCALES에 없는 사전이 레지스트리에 남아있지 않다 (도달 불가 사전)", () => {
    expect(findExtraneous(LOCALES, locales)).toEqual([]);
  });

  // BCP47도 폴백 금지 — 누락되면 날짜가 엉뚱한 로케일 포맷으로 찍힌다.
  it("BCP47이 모든 등록 로케일을 커버한다", () => {
    expect(findUncovered(LOCALES, BCP47)).toEqual([]);
  });
});

describe("LOCALES 레지스트리 자체", () => {
  it("기준 로케일과 기본 로케일이 등록돼 있다", () => {
    expect(LOCALES).toContain(BASE_LOCALE);
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("현재 ko·en을 포함한다", () => {
    expect(LOCALES).toContain("ko");
    expect(LOCALES).toContain("en");
  });

  it("중복 등록이 없다", () => {
    expect([...new Set(LOCALES)]).toEqual([...LOCALES]);
  });
});
