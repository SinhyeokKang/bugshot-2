import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findProperNounViolations } from "@/test/proper-nouns";
import type { LocaleMode } from "../locales";
import { readManifestRegistry } from "@/test/manifest-registry";
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifestRegistry = readManifestRegistry(join(repoRoot, "public", "_locales"));

// 사람이 검수한 로케일. `BASE_LOCALE`/`DEFAULT_LOCALE`에서 파생하지 않는다 — 그 둘은 각각
// "키 정의 원본"과 "미지 값의 폴백"이라 축이 다르고, 폴백을 새 로케일로 옮기는 순간 검수 안 된
// 사전이 기준이 되어 판정이 무음으로 약해진다. 새 로케일이 검수를 거치면 여기 추가한다.
const REVIEWED_LOCALES: readonly LocaleMode[] = ["ko", "en"];

// 사전 세 벌 전부 — 하나라도 빼면 그 표면의 오역만 조용히 샌다.
describe("고유명사 보존 — 사전 세 벌", () => {
  it("메인 사전 (src/i18n)", () => {
    expect(findProperNounViolations(locales, PROPER_NOUNS, REVIEWED_LOCALES)).toEqual([]);
  });

  it("log-viewer 복제 사전", () => {
    expect(findProperNounViolations(DICTS, PROPER_NOUNS, REVIEWED_LOCALES)).toEqual([]);
  });

  // 이 값은 웹스토어 등록정보로도 나간다 — BugShot 제품명 소실이 여기서 걸린다.
  it("manifest _locales 사전", () => {
    expect(findProperNounViolations(manifestRegistry, PROPER_NOUNS, REVIEWED_LOCALES)).toEqual([]);
  });
});
