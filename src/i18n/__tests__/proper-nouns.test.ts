import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findProperNounViolations } from "@/test/proper-nouns";
import type { LocaleRegistry } from "@/test/locale-parity";
import { locales } from "../index";
import { DICTS } from "@/log-viewer/i18n";

// 사람 검수 없이 내는 AI 초벌 번역(PRD "품질 정책")에서 자동으로 막을 수 있는 유일한
// 오역 축 — 플랫폼 고유명사가 번역돼 사라지는 것. ko/en 값이 둘 다 담고 있는 명사는
// 다른 로케일 값에도 그대로 있어야 한다.
//
// 알려진 한계 (과신 금지 — 실측은 design.md "가드의 실제 사정거리"):
// - 98쌍 중 20쌍은 ko=en=토큰 자체(platform.tab.* 류)라 복붙이면 통과하는 vacuous 단언.
// - `cURL`이 토큰 `URL`을 부분문자열로 우연 만족시킨다.
// - ko∩en 필터가 실제로 거르는 건 1쌍뿐(ko 사전에 한글 음역이 없어서).
// - 서드파티 UI 경로 문자열(Settings > Apps 류)은 이 가드 밖 — 번역 브리프 소관.
const PROPER_NOUNS = [
  "Jira", "GitHub", "Linear", "Notion", "GitLab", "Asana", "ClickUp", "Slack",
  "BugShot", "Chrome", "OAuth", "CSS", "URL", "JSON",
  // HTML은 뺐다 — ko/en 어디에도 없어(유일한 등장은 logs.html 소문자) 영구히 아무것도
  // 단언하지 않는 죽은 항목이다.
] as const;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const localesDir = join(repoRoot, "public", "_locales");

type ChromeMessages = Record<string, { message: string }>;
const manifestRegistry: LocaleRegistry = Object.fromEntries(
  readdirSync(localesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const raw = JSON.parse(
        readFileSync(join(localesDir, e.name, "messages.json"), "utf8"),
      ) as ChromeMessages;
      return [e.name, Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]))];
    }),
);

// 사전 세 벌 전부 — 하나라도 빼면 그 표면의 오역만 조용히 샌다.
describe("고유명사 보존 — 사전 세 벌", () => {
  it("메인 사전 (src/i18n)", () => {
    expect(findProperNounViolations(locales, PROPER_NOUNS)).toEqual([]);
  });

  it("log-viewer 복제 사전", () => {
    expect(findProperNounViolations(DICTS, PROPER_NOUNS)).toEqual([]);
  });

  // 이 값은 웹스토어 등록정보로도 나간다 — BugShot 제품명 소실이 여기서 걸린다.
  it("manifest _locales 사전", () => {
    expect(findProperNounViolations(manifestRegistry, PROPER_NOUNS)).toEqual([]);
  });
});
