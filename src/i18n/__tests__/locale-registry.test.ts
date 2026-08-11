import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BASE_LOCALE,
  BCP47,
  DEFAULT_LOCALE,
  LOCALES,
  detectLocale,
  matchLocaleTag,
  normalizeLocale,
} from "../locales";

describe("normalizeLocale", () => {
  it("등록된 로케일은 그대로 보존한다", () => {
    expect(normalizeLocale("ko")).toBe("ko");
    expect(normalizeLocale("en")).toBe("en");
  });

  // 다운그레이드 경로: 새 로케일을 쓰던 사용자가 구버전 확장으로 롤백되면 persist에
  // 그 코드가 남는다. 정규화가 없으면 locales[locale]이 undefined라 t()가 죽는다.
  it("등록되지 않은 미래 로케일은 기본 로케일로 되돌린다", () => {
    expect(normalizeLocale("ja")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE);
  });

  it("비문자열·빈 값도 기본 로케일로 정규화한다", () => {
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(42)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale({})).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("")).toBe(DEFAULT_LOCALE);
  });

  // 우리가 쓰는 값은 항상 소문자다. normalizeAiLanguage와 같이 관용을 두지 않는다 —
  // 저장값 게이트에서 관용을 두면 어떤 표기가 정본인지 흐려진다.
  it("대소문자 관용이 없다 (저장값 게이트)", () => {
    expect(normalizeLocale("KO")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("En")).toBe(DEFAULT_LOCALE);
  });

  it("멱등하다", () => {
    for (const locale of LOCALES) {
      expect(normalizeLocale(normalizeLocale(locale))).toBe(locale);
    }
  });
});

// LOCALES 선언 순서에 매칭이 좌우되면, `pt` 다음에 `pt-BR`을 추가했을 때 짧은 쪽이 먼저
// 먹어 긴 쪽이 영구 도달 불가가 된다. 로케일 추가를 안전하게 만드는 게 이 모듈의 목적이라
// 확장 시점의 함정을 규칙 자체로 막는다 — 가장 구체적인(=긴) 코드가 이긴다.
describe("matchLocaleTag", () => {
  it("겹치는 후보 중 가장 긴 것을 고른다", () => {
    expect(matchLocaleTag("pt-br", ["pt", "pt-br"])).toBe("pt-br");
  });

  it("후보 배열 순서에 좌우되지 않는다", () => {
    expect(matchLocaleTag("pt-br", ["pt-br", "pt"])).toBe("pt-br");
    expect(matchLocaleTag("pt-br", ["pt", "pt-br"])).toBe("pt-br");
  });

  it("더 구체적인 후보가 없으면 짧은 쪽으로 떨어진다", () => {
    expect(matchLocaleTag("pt-pt", ["pt", "pt-br"])).toBe("pt");
  });

  it("접두 일치가 없으면 undefined", () => {
    expect(matchLocaleTag("fr-fr", ["pt", "en"])).toBeUndefined();
    expect(matchLocaleTag("", ["ko", "en"])).toBeUndefined();
  });

  it("후보가 비면 undefined", () => {
    expect(matchLocaleTag("ko-kr", [])).toBeUndefined();
  });
});

describe("detectLocale", () => {
  // normalizeLocale과 달리 이쪽은 브라우저가 주는 힌트라 관용적이다 — 지역 서브태그와
  // 대소문자를 흡수한다. 두 함수의 엄격도가 다른 게 의도다.
  it("지역 서브태그가 붙어도 언어로 매칭한다", () => {
    expect(detectLocale("ko-KR")).toBe("ko");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("en-GB")).toBe("en");
  });

  it("언어 코드만 와도 매칭한다", () => {
    expect(detectLocale("ko")).toBe("ko");
    expect(detectLocale("en")).toBe("en");
  });

  it("대소문자를 흡수한다", () => {
    expect(detectLocale("KO-kr")).toBe("ko");
    expect(detectLocale("EN-US")).toBe("en");
  });

  it("등록되지 않은 언어는 기본 로케일로 폴백한다", () => {
    expect(detectLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(detectLocale("ja")).toBe(DEFAULT_LOCALE);
    expect(detectLocale("zh-CN")).toBe(DEFAULT_LOCALE);
  });

  // navigator가 없는 환경(service worker 초기화·node 테스트)에서 호출된다.
  it("빈 값·undefined는 기본 로케일이다", () => {
    expect(detectLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(detectLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("반환값은 항상 등록된 로케일이다", () => {
    for (const tag of ["ko-KR", "en-US", "fr", "", undefined, "xx-YY"]) {
      expect(LOCALES).toContain(detectLocale(tag));
    }
  });
});

describe("BCP47", () => {
  // 날짜 포맷 회귀 핀 — 기존 dateBcp47() 동작을 그대로 유지해야 한다.
  it("기존 ko/en 태그를 보존한다", () => {
    expect(BCP47.ko).toBe("ko-KR");
    expect(BCP47.en).toBe("en-US");
  });
});

describe("기준·기본 로케일", () => {
  it("BASE_LOCALE은 ko다 (TranslationKey를 정의하는 사전)", () => {
    expect(BASE_LOCALE).toBe("ko");
  });

  // 미지 값이 떨어질 곳이라 영어여야 한다 — 모르는 사용자에게 한국어를 주면 안 된다.
  it("DEFAULT_LOCALE은 en이다 (폴백 기준)", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

// locales.ts는 background(service worker)와 log-viewer 번들 양쪽에서 쓰인다.
// log-viewer는 vite alias가 `@/i18n`을 복제 사전으로 돌리므로 상대경로로 이 파일을
// 직접 끌어간다 — 여기에 store(zustand+chrome.storage)가 딸려오면 그 번들이 깨진다.
describe("locales.ts 순수성 (레이어링 불변식)", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "locales.ts"),
    "utf8",
  );

  const runtimeImports = [
    ...source.matchAll(/\bimport\s+(?!type\s)[\s\S]*?\bfrom\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);

  // 검사 대상은 코드다. 주석이 `chrome.storage`를 설명으로 언급하는 건 위반이 아니라
  // 오히려 이 불변식의 근거 서술이므로, 스캔 전에 주석을 걷어낸다.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("런타임 의존이 없다 (store·sidepanel·zustand·chrome 래퍼 전부)", () => {
    expect(runtimeImports).toEqual([]);
  });

  it("chrome API를 직접 만지지 않는다", () => {
    expect(code).not.toMatch(/\bchrome\s*\./);
  });

  it("navigator를 직접 읽지 않는다 (detectLocale이 인자로 받는 이유)", () => {
    expect(code).not.toMatch(/\bnavigator\s*\./);
  });

  // 위 두 단언은 주석을 걷어낸 뒤 재므로, 스트리퍼가 통째로 지워버리면 vacuous green이 된다.
  it("주석 스트리퍼가 코드를 남긴다 (자기검증 앵커)", () => {
    expect(code).toMatch(/export function normalizeLocale/);
    expect(code).toMatch(/export const LOCALES/);
  });
});
