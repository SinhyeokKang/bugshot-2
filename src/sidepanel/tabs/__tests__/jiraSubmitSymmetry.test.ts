import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Jira 제출 진입점은 둘이고(캡처→제출 / 드래프트 재제출) 둘 다 같은 레코드를 남겨야 한다.
// 한 곳만 고치면 siteId 없는 레코드가 덮어써져 initialJiraFields의 sameSite 게이트가 **무음으로**
// 사라진다 — 그래서 design §9이 "반드시 함께"라고 못박았다. 두 다이얼로그는 렌더 테스트 비용이
// 크고(제출까지 태우려면 캡처·업로드 전부를 모킹해야 한다) e2e는 IssueCreateModal 경로만 태우므로,
// 대칭 자체는 소스 스캔으로 고정한다(builderLocaleWrap.test.ts와 같은 계열의 그물).

const ENTRY_POINTS = [
  "src/sidepanel/tabs/IssueCreateModal.tsx",
  "src/sidepanel/tabs/DraftDetailDialog.tsx",
] as const;

// 유효 프로젝트는 이번 제출의 필드값이고 계정 설정은 fallback일 뿐이다 — 이 3개가 빠지면
// sticky(프로젝트·이슈타입)와 사이트 판별자가 죽는다.
const REQUIRED_KEYS = ["projectKey", "issueTypeId", "siteId"] as const;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// `setLastSubmitFields("jira", { … })`의 객체 리터럴 본문만 잘라낸다.
function lastSubmitPayload(src: string): string {
  const start = src.indexOf('setLastSubmitFields("jira", {');
  expect(start, "setLastSubmitFields(\"jira\", …) 호출을 못 찾았다").toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("payload 리터럴이 닫히지 않았다");
}

describe("Jira 제출 진입점 대칭", () => {
  it.each(ENTRY_POINTS)("%s의 lastSubmitFields가 3개 키를 모두 기록한다", (path) => {
    const payload = lastSubmitPayload(source(path));
    for (const key of REQUIRED_KEYS) {
      expect(payload, `${key}가 빠졌다`).toMatch(new RegExp(`\\b${key}\\b`));
    }
    // siteId는 계정 auth에서 파생해야 한다 — 상수나 다른 출처면 게이트가 공허해진다.
    expect(payload).toMatch(/siteId:\s*jiraSiteId\(/);
  });

  it("두 진입점이 같은 키 집합을 기록한다", () => {
    const [a, b] = ENTRY_POINTS.map((p) => keysOf(lastSubmitPayload(source(p))));
    expect(a).toEqual(b);
  });

  // 제출 payload와 lastSubmitFields 둘 다 계정 설정이 아니라 유효 프로젝트를 써야 한다.
  it.each(ENTRY_POINTS)("%s가 계정 기본 프로젝트를 제출에 직접 쓰지 않는다", (path) => {
    expect(source(path)).not.toMatch(/projectKey:\s*jiraAccount[?.]*\.projectKey/);
  });
});

// `key,` / `key: value,` 최상위 항목만 (중첩 객체는 이 payload에 없다).
function keysOf(payload: string): string[] {
  return [...payload.matchAll(/^\s{6}(\w+)[,:]/gm)].map((m) => m[1]).sort();
}
