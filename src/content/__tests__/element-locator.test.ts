import { describe, expect, it } from "vitest";

import {
  TRUSTED_TEST_ATTRIBUTES,
  compareSelectorScores,
  isStableAttribute,
  isStableClassName,
  isStableIdName,
  scoreSelector,
} from "../element-locator";

/* ------------------------------------------------------------------ */
/*  신뢰 test attribute                                                 */
/*  finder 기본 attr predicate는 wordLike 게이트(숫자 불허 + 하이픈/대문자  */
/*  분절 후 각 토큰 3자 이상) 때문에 8개 중 6개를 후보로도 만들지 않는다.    */
/*  stable 단계가 이 allowlist를 명시적으로 통과시켜야 앵커가 생긴다.        */
/* ------------------------------------------------------------------ */

describe("TRUSTED_TEST_ATTRIBUTES", () => {
  it("8개 exact name만 담는다", () => {
    expect([...TRUSTED_TEST_ATTRIBUTES].sort()).toEqual(
      [
        "data-automation-id",
        "data-cy",
        "data-e2e",
        "data-pw",
        "data-qa",
        "data-test",
        "data-test-id",
        "data-testid",
      ].sort(),
    );
  });
});

describe("isStableAttribute", () => {
  it("신뢰 test attribute + 일반 값이면 통과한다", () => {
    expect(isStableAttribute("data-e2e", "enrollment-card")).toBe(true);
    expect(isStableAttribute("data-testid", "checkout-panel")).toBe(true);
  });

  it("finder 기본 semantic attribute도 통과한다", () => {
    expect(isStableAttribute("role", "dialog")).toBe(true);
    expect(isStableAttribute("name", "email")).toBe(true);
    expect(isStableAttribute("aria-label", "close")).toBe(true);
    expect(isStableAttribute("for", "email-input")).toBe(true);
  });

  it("임의 data-* 는 통과하지 않는다", () => {
    expect(isStableAttribute("data-user-id", "42")).toBe(false);
    expect(isStableAttribute("data-index", "3")).toBe(false);
    expect(isStableAttribute("data-selected", "true")).toBe(false);
    expect(isStableAttribute("data-reactid", "0.1.2")).toBe(false);
  });

  it("이름이 test contract여도 값이 동적이면 통과하지 않는다", () => {
    expect(
      isStableAttribute(
        "data-testid",
        "user-550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe(false);
    expect(isStableAttribute("data-e2e", "row-1754812800000")).toBe(false);
  });

  it("빈 값·100자 초과·제어문자는 통과하지 않는다", () => {
    expect(isStableAttribute("data-testid", "")).toBe(false);
    expect(isStableAttribute("data-testid", "a".repeat(101))).toBe(false);
    expect(isStableAttribute("data-testid", "a\nb")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  동적 ID / class 거부                                                */
/* ------------------------------------------------------------------ */

describe("isStableIdName", () => {
  it("사람이 지은 ID는 통과한다", () => {
    expect(isStableIdName("checkout")).toBe(true);
    expect(isStableIdName("main-nav")).toBe(true);
  });

  it("UUID·긴 숫자열·연속 hex는 거부한다", () => {
    expect(isStableIdName("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isStableIdName("row-1754812800000")).toBe(false);
    expect(isStableIdName("id-a1b2c3d4e5")).toBe(false);
  });

  it("프레임워크 생성 ID를 거부한다", () => {
    expect(isStableIdName(":r3:")).toBe(false);
    expect(isStableIdName("__id_12")).toBe(false);
    expect(isStableIdName("ember427")).toBe(false);
    expect(isStableIdName("mui-42")).toBe(false);
  });
});

describe("isStableClassName", () => {
  it("BEM·semantic class는 통과한다", () => {
    expect(isStableClassName("card-body")).toBe(true);
    expect(isStableClassName("btn")).toBe(true);
    expect(isStableClassName("Nav__item--active")).toBe(true);
  });

  it("해시 suffix가 붙은 CSS Modules class를 거부한다", () => {
    expect(isStableClassName("Component_ab12cd34")).toBe(false);
    expect(isStableClassName("button_1x2y3z4w")).toBe(false);
  });

  it("전체가 일반 단어·하이픈 조합이면 길어도 통과한다", () => {
    expect(isStableClassName("text-semantic-informative-primary-low")).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ */
/*  후보 비교 — (positional, stage, length)                             */
/*  finder가 이미 누적 penalty 오름차순으로 유일한 첫 후보를 주므로         */
/*  사람이 다시 매길 축은 이 셋뿐이다.                                   */
/* ------------------------------------------------------------------ */

describe("scoreSelector", () => {
  it("위치 토큰이 없으면 positional 0", () => {
    expect(scoreSelector('[data-e2e="card"] span', 0)[0]).toBe(0);
  });

  it(":nth-of-type / :nth-child 어느 쪽이든 positional 1", () => {
    expect(scoreSelector("article:nth-of-type(1) span", 0)[0]).toBe(1);
    expect(scoreSelector("li:nth-child(3) > a", 1)[0]).toBe(1);
  });

  it("stage와 length를 그대로 싣는다", () => {
    expect(scoreSelector("span", 1)).toEqual([0, 1, 4]);
  });
});

describe("compareSelectorScores", () => {
  const stable = (s: string) => scoreSelector(s, 0);
  const compat = (s: string) => scoreSelector(s, 1);

  it("위치 없는 후보가 위치 있는 후보를 이긴다", () => {
    expect(
      compareSelectorScores(compat(".badge-hot"), stable("li:nth-child(1) > span")),
    ).toBeLessThan(0);
  });

  it("둘 다 위치가 없으면 stable 단계가 이긴다", () => {
    expect(
      compareSelectorScores(stable("p > span"), compat(".inline-block")),
    ).toBeLessThan(0);
  });

  it("둘 다 위치가 있으면 stable 단계가 이긴다", () => {
    expect(
      compareSelectorScores(
        stable("article:nth-of-type(1) span"),
        compat("article:nth-of-type(1) .chip"),
      ),
    ).toBeLessThan(0);
  });

  it("같은 단계·같은 위치면 짧은 쪽이 이긴다", () => {
    expect(
      compareSelectorScores(stable("a > b"), stable("a > b > c")),
    ).toBeLessThan(0);
  });

  it("완전히 같으면 0", () => {
    expect(compareSelectorScores(stable("span"), stable("span"))).toBe(0);
  });
});
