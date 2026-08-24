import { describe, expect, it } from "vitest";
import { findProperNounViolations } from "../proper-nouns";
import type { LocaleRegistry } from "../locale-parity";

// locale-parity.test.ts와 같은 역할 — 실사전 적용 테스트(i18n/__tests__/proper-nouns.test.ts)는
// "지금 사전이 위반 0"만 말하므로 검사기가 고장 나도 초록이다. 여기서 일부러 깨뜨린 fixture로
// 검사기가 실제로 빨개지는지를 고정한다.

const BASE_PAIR = ["ko", "en"] as const;

const HEALTHY: LocaleRegistry = {
  ko: { "a.connect": "Jira 연결", "a.plain": "설정 열기" },
  en: { "a.connect": "Connect Jira", "a.plain": "Open settings" },
  fr: { "a.connect": "Connecter Jira", "a.plain": "Ouvrir les réglages" },
};

describe("findProperNounViolations — 정상", () => {
  it("고유명사가 보존된 레지스트리는 위반이 없다", () => {
    expect(findProperNounViolations(HEALTHY, ["Jira"], BASE_PAIR)).toEqual([]);
  });

  it("ko/en 2개뿐인 레지스트리는 검사할 제3 로케일이 없어 위반이 없다", () => {
    const { ko, en } = HEALTHY;
    expect(findProperNounViolations({ ko, en }, ["Jira"], BASE_PAIR)).toEqual([]);
  });
});

describe("findProperNounViolations — 위반 검출", () => {
  it("제3 로케일이 고유명사를 번역해버리면 잡는다", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      fr: { "a.connect": "Connecter Logiciel", "a.plain": "Ouvrir les réglages" },
    };
    expect(findProperNounViolations(registry, ["Jira"], BASE_PAIR)).toEqual([
      "fr a.connect: 'Jira' 소실",
    ]);
  });

  it("한 값에서 여러 명사가 소실되면 전부 잡는다", () => {
    const registry: LocaleRegistry = {
      ko: { k: "Jira와 GitHub 연동" },
      en: { k: "Jira & GitHub integration" },
      fr: { k: "Intégration des trackers" },
    };
    expect(findProperNounViolations(registry, ["GitHub", "Jira"], BASE_PAIR)).toEqual([
      "fr k: 'GitHub' 소실",
      "fr k: 'Jira' 소실",
    ]);
  });
});

describe("findProperNounViolations — 검사 제외 경계", () => {
  it("ko/en 중 한쪽에만 있는 명사는 검사하지 않는다 (번역 재량)", () => {
    const registry: LocaleRegistry = {
      ko: { k: "지라 연결" }, // 한글 음역 — en에만 Jira
      en: { k: "Connect Jira" },
      fr: { k: "Connecter le tracker" },
    };
    expect(findProperNounViolations(registry, ["Jira"], BASE_PAIR)).toEqual([]);
  });

  it("제3 로케일에 키가 없으면 여기서는 침묵한다 (누락은 parity 소관)", () => {
    const registry: LocaleRegistry = {
      ko: { k: "Jira 연결" },
      en: { k: "Connect Jira" },
      fr: {},
    };
    expect(findProperNounViolations(registry, ["Jira"], BASE_PAIR)).toEqual([]);
  });
});

describe("findProperNounViolations — 기준 사전 부재", () => {
  it("기준 로케일 사전이 없으면 침묵하지 않고 위반으로 보고한다", () => {
    const { en, fr } = HEALTHY;
    expect(findProperNounViolations({ en, fr }, ["Jira"], BASE_PAIR)).toEqual([
      "ko: 기준 로케일 사전이 없다",
    ]);
  });

  it("기준 사전이 여러 개 없으면 전부 보고한다", () => {
    const { fr } = HEALTHY;
    expect(findProperNounViolations({ fr }, ["Jira"], BASE_PAIR)).toEqual([
      "ko: 기준 로케일 사전이 없다",
      "en: 기준 로케일 사전이 없다",
    ]);
  });

  it("기준 로케일이 아예 안 넘어오면 크래시 대신 위반을 반환한다", () => {
    expect(findProperNounViolations(HEALTHY, ["Jira"], [])).toEqual([
      "기준 로케일이 지정되지 않았다",
    ]);
  });
});
