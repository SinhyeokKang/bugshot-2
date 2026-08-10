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

  it("semantic attribute는 좁은 값 정책을 유지한다", () => {
    // 여기를 넓히면 화면 텍스트·URL이 selector에 실려 이슈 본문으로 나간다.
    expect(isStableAttribute("aria-label", "Close order #12345 for Jane")).toBe(
      false,
    );
    expect(isStableAttribute("href", "/account?email=jane%40acme.com")).toBe(
      false,
    );
    expect(isStableAttribute("name", "customer2837465")).toBe(false);
    expect(isStableAttribute("for", "user-2837465")).toBe(false);
  });

  // selector는 이슈 본문·8개 플랫폼 페이로드·저장 초안·LLM endpoint로 나간다.
  // test contract 속성이라고 값이 안전한 게 아니다 — 리스트 행마다
  // data-testid={user.email} 같은 코드가 흔하다.
  it("test contract 속성이어도 PII·런타임 식별자 값은 통과시키지 않는다", () => {
    expect(isStableAttribute("data-testid", "user-jane@acme.com")).toBe(false);
    expect(isStableAttribute("data-testid", "jane.doe@example.co.kr")).toBe(
      false,
    );
    expect(isStableAttribute("data-cy", "010-1234-5678")).toBe(false);
    expect(isStableAttribute("data-qa", "order-2026-0810-KR")).toBe(false);
    expect(isStableAttribute("data-test", "ORD-99213")).toBe(false);
    expect(isStableAttribute("data-e2e", "sess_9f2k1lQz")).toBe(false);
    expect(isStableAttribute("data-pw", "김철수")).toBe(false);
    expect(isStableAttribute("data-testid", "user jane")).toBe(false);
  });

  it("사람이 지은 컴포넌트 이름은 통과한다", () => {
    expect(isStableAttribute("data-e2e", "enrollment-card")).toBe(true);
    expect(isStableAttribute("data-testid", "submitBtn")).toBe(true);
    expect(isStableAttribute("data-testid", "nav_item")).toBe(true);
    // 짧은 인덱스 꼬리는 흔한 정당 케이스라 남긴다.
    expect(isStableAttribute("data-testid", "tab-1")).toBe(true);
    expect(isStableAttribute("data-testid", "row-12")).toBe(true);
  });

  // 이 기능의 목적이 "finder가 못 여는 test contract 앵커를 여는 것"인데, 단어 사이에
  // 숫자가 낀 정상 식별자까지 막으면 그 목적이 그 값들에 대해 무효가 된다.
  it("단어 사이에 숫자가 낀 식별자는 통과하되 토큰 모양은 계속 거부한다", () => {
    expect(isStableAttribute("data-testid", "oauth2button")).toBe(true);
    expect(isStableAttribute("data-testid", "html5video")).toBe(true);
    expect(isStableAttribute("data-testid", "checkoutStep2")).toBe(true);
    expect(isStableAttribute("data-testid", "otpInput6")).toBe(true);
    // 숫자로 시작하거나 숫자가 산재하면 여전히 토큰으로 본다.
    expect(isStableAttribute("data-e2e", "sess_9f2k1lQz")).toBe(false);
    expect(isStableAttribute("data-testid", "user12345")).toBe(false);
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

  // id는 finder penalty 0이라 stage 0에서 최우선 채택된다. attribute 쪽만 좁히면
  // 같은 문자열이 `for`에서는 막히고 `id`에서는 통과하는 비대칭이 남는다.
  it("ID도 attribute와 같은 식별자 정책을 태운다", () => {
    expect(isStableIdName("user-jane@acme.com")).toBe(false);
    expect(isStableIdName("010-1234-5678")).toBe(false);
    expect(isStableIdName("Jane Doe order")).toBe(false);
    expect(isStableIdName("sess_9f2k1lQz")).toBe(false);
  });

  // isStableAttribute와 같은 상한을 둔다 — id도 selector 문자열을 타고 본문으로 나간다.
  it("100자 초과·제어문자 ID를 거부한다", () => {
    expect(isStableIdName(`section-${"x".repeat(93)}`)).toBe(false); // 101자
    expect(isStableIdName("a\nb")).toBe(false);
    expect(isStableIdName(`section-${"x".repeat(92)}`)).toBe(true); // 100자
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

  it("emotion·styled-components·JSS 해시 class를 거부한다", () => {
    expect(isStableClassName("css-1q2w3e4")).toBe(false);
    expect(isStableClassName("sc-bdVaJa")).toBe(false);
    expect(isStableClassName("jss-42")).toBe(false);
  });

  it("MUI의 실제 안정 class는 통과한다", () => {
    expect(isStableClassName("MuiButton-root")).toBe(true);
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

  // 이 기능의 핵심 계약 — 앵커 후보가 compat의 짧은 class 후보보다 길어도 이겨야 한다.
  // 길이가 같은 방향인 케이스만 두면 stage 키를 삭제한 뮤턴트가 살아남는다.
  it("stable 단계는 문자열이 더 길어도 compat을 이긴다", () => {
    expect(
      compareSelectorScores(
        stable('[data-testid="checkout-panel"] button'),
        compat(".pay"),
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
