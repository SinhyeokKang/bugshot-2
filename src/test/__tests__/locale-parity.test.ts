import { describe, expect, it } from "vitest";
import {
  findExtraneous,
  findParityViolations,
  findUncovered,
  placeholderTokens,
  type LocaleRegistry,
} from "../locale-parity";

// 이 파일이 이 리팩터의 red 증명이다. locales.test.ts·log-viewer/i18n.test.ts는 "실제 사전이
// 대칭이다"만 말하므로 항상 초록이고, 검사기가 고장 나도 초록이다(vacuous green). 여기서
// 일부러 깨뜨린 3번째 로케일 fixture로 검사기가 실제로 빨개지는지를 고정한다 — 그물이
// 헐거워지는 회귀는 이 파일에서만 잡힌다.

// a.bye·a.hello는 토큰이 없고 a.count·a.who는 있다. 빈 값 케이스가 토큰 위반을 덤으로
// 끌고 오지 않게 두 종류를 분리해 둔 것.
const HEALTHY: LocaleRegistry = {
  ko: { "a.bye": "잘가", "a.count": "{n}개", "a.hello": "안녕", "a.who": "{name}님" },
  en: { "a.bye": "Bye", "a.count": "{n} items", "a.hello": "Hello", "a.who": "Mr. {name}" },
};

const JA_HEALTHY = {
  "a.bye": "さようなら",
  "a.count": "{n}件",
  "a.hello": "こんにちは",
  "a.who": "{name}様",
};

describe("findParityViolations — 정상 레지스트리", () => {
  it("대칭인 레지스트리는 위반이 없다", () => {
    expect(findParityViolations(HEALTHY, "ko")).toEqual([]);
  });

  it("로케일이 3개여도 전부 대칭이면 위반이 없다", () => {
    expect(findParityViolations({ ...HEALTHY, ja: JA_HEALTHY }, "ko")).toEqual([]);
  });
});

describe("findParityViolations — 3번째 로케일이 깨졌을 때", () => {
  it("키가 누락되면 잡는다", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      ja: { "a.hello": "こんにちは" },
    };
    expect(findParityViolations(registry, "ko")).toEqual([
      "ja a.bye: 누락",
      "ja a.count: 누락",
      "ja a.who: 누락",
    ]);
  });

  it("사전이 통째로 비면 기준 로케일의 모든 키를 누락으로 잡는다", () => {
    expect(findParityViolations({ ...HEALTHY, ja: {} }, "ko")).toEqual([
      "ja a.bye: 누락",
      "ja a.count: 누락",
      "ja a.hello: 누락",
      "ja a.who: 누락",
    ]);
  });

  it("기준에 없는 잉여 키를 잡는다 (오타로 만든 유령 키)", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      ja: { ...JA_HEALTHY, "a.helo": "typo" },
    };
    expect(findParityViolations(registry, "ko")).toEqual([
      "ja a.helo: ko에 없는 잉여 키",
    ]);
  });

  it("빈 문자열·공백뿐인 값을 잡는다 (번역 미완인 채 머지되는 경로)", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      ja: { ...JA_HEALTHY, "a.bye": "", "a.hello": "   " },
    };
    expect(findParityViolations(registry, "ko")).toEqual([
      "ja a.bye: 빈 값",
      "ja a.hello: 빈 값",
    ]);
  });

  it("placeholder 토큰이 어긋나면 잡는다 (치환 실패 → UI에 리터럴 노출)", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      ja: { ...JA_HEALTHY, "a.count": "{count}件" },
    };
    expect(findParityViolations(registry, "ko")).toEqual([
      "ja a.count: 토큰 [count] ≠ ko [n]",
    ]);
  });

  it("토큰이 통째로 빠져도 잡는다", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      ja: { ...JA_HEALTHY, "a.count": "たくさん" },
    };
    expect(findParityViolations(registry, "ko")).toEqual([
      "ja a.count: 토큰 [] ≠ ko [n]",
    ]);
  });

  it("여러 종류가 겹쳐도 전부 모아서 보고한다", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      ja: { "a.hello": "", "a.count": "{count}件" },
    };
    expect(findParityViolations(registry, "ko")).toEqual(
      [
        "ja a.hello: 빈 값",
        "ja a.bye: 누락",
        "ja a.who: 누락",
        "ja a.count: 토큰 [count] ≠ ko [n]",
      ].sort(),
    );
  });
});

describe("findParityViolations — 기준 로케일 자체", () => {
  it("기준 사전이 없으면 조용히 통과하지 않는다", () => {
    expect(findParityViolations({ en: HEALTHY.en }, "ko")).toEqual([
      "ko: 기준 로케일 사전이 없다",
    ]);
  });

  it("기준 로케일의 빈 값도 잡는다", () => {
    const registry: LocaleRegistry = {
      ko: { ...HEALTHY.ko, "a.hello": "" },
      en: HEALTHY.en,
    };
    expect(findParityViolations(registry, "ko")).toEqual(["ko a.hello: 빈 값"]);
  });
});

describe("findUncovered", () => {
  it("등록됐는데 사전이 없는 로케일을 잡는다", () => {
    expect(findUncovered(["ko", "en", "ja"], HEALTHY)).toEqual(["ja"]);
  });

  it("전부 커버되면 빈 배열", () => {
    expect(findUncovered(["ko", "en"], HEALTHY)).toEqual([]);
  });

  // BCP47처럼 값이 문자열인 메타 테이블에도 같은 함수를 쓴다.
  it("문자열 맵에도 동작한다 (BCP47 커버리지)", () => {
    expect(findUncovered(["ko", "en", "ja"], { ko: "ko-KR", en: "en-US" })).toEqual(["ja"]);
  });

  it("undefined·null 값을 미커버로 본다 (키만 있고 값이 빈 경우)", () => {
    expect(findUncovered(["ko", "en"], { ko: "ko-KR", en: undefined })).toEqual(["en"]);
  });
});

describe("findExtraneous", () => {
  it("사전은 있는데 LOCALES에 없어 도달 불가한 로케일을 잡는다", () => {
    expect(findExtraneous(["ko"], HEALTHY)).toEqual(["en"]);
  });

  it("전부 등록돼 있으면 빈 배열", () => {
    expect(findExtraneous(["ko", "en"], HEALTHY)).toEqual([]);
  });
});

describe("placeholderTokens", () => {
  it("토큰 이름을 정렬해 뽑는다", () => {
    expect(placeholderTokens("{max}개 중 {count}개")).toEqual(["count", "max"]);
  });

  it("토큰이 없으면 빈 배열", () => {
    expect(placeholderTokens("그냥 문장")).toEqual([]);
  });

  // 식별자 형태가 아닌 중괄호는 토큰이 아니다 — CSS·코드 예시 문구가 오탐되면 안 된다.
  it("식별자가 아닌 중괄호는 무시한다", () => {
    expect(placeholderTokens("body { color: red }")).toEqual([]);
    expect(placeholderTokens("{1}")).toEqual([]);
  });
});
