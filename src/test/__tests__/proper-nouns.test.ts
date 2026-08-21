import { describe, expect, it } from "vitest";
import { findProperNounViolations } from "../proper-nouns";
import type { LocaleRegistry } from "../locale-parity";

// locale-parity.test.ts와 같은 역할 — 실사전 적용 테스트(i18n/__tests__/proper-nouns.test.ts)는
// "지금 사전이 위반 0"만 말하므로 검사기가 고장 나도 초록이다. 여기서 일부러 깨뜨린 fixture로
// 검사기가 실제로 빨개지는지를 고정한다.

const HEALTHY: LocaleRegistry = {
  ko: { "a.connect": "Jira 연결", "a.plain": "설정 열기" },
  en: { "a.connect": "Connect Jira", "a.plain": "Open settings" },
  fr: { "a.connect": "Connecter Jira", "a.plain": "Ouvrir les réglages" },
};

describe("findProperNounViolations — 정상", () => {
  it("고유명사가 보존된 레지스트리는 위반이 없다", () => {
    expect(findProperNounViolations(HEALTHY, ["Jira"])).toEqual([]);
  });

  it("ko/en 2개뿐인 레지스트리는 검사할 제3 로케일이 없어 위반이 없다", () => {
    const { ko, en } = HEALTHY;
    expect(findProperNounViolations({ ko, en }, ["Jira"])).toEqual([]);
  });
});

describe("findProperNounViolations — 위반 검출", () => {
  it("제3 로케일이 고유명사를 번역해버리면 잡는다", () => {
    const registry: LocaleRegistry = {
      ...HEALTHY,
      fr: { "a.connect": "Connecter Logiciel", "a.plain": "Ouvrir les réglages" },
    };
    expect(findProperNounViolations(registry, ["Jira"])).toEqual([
      "fr a.connect: 'Jira' 소실",
    ]);
  });

  it("한 값에서 여러 명사가 소실되면 전부 잡는다", () => {
    const registry: LocaleRegistry = {
      ko: { k: "Jira와 GitHub 연동" },
      en: { k: "Jira & GitHub integration" },
      fr: { k: "Intégration des trackers" },
    };
    expect(findProperNounViolations(registry, ["GitHub", "Jira"])).toEqual([
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
    expect(findProperNounViolations(registry, ["Jira"])).toEqual([]);
  });

  it("제3 로케일에 키가 없으면 여기서는 침묵한다 (누락은 parity 소관)", () => {
    const registry: LocaleRegistry = {
      ko: { k: "Jira 연결" },
      en: { k: "Connect Jira" },
      fr: {},
    };
    expect(findProperNounViolations(registry, ["Jira"])).toEqual([]);
  });
});
