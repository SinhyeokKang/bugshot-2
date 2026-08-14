import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Jira 제출 진입점은 둘이고(캡처→제출 / 드래프트 재제출) 둘 다 같은 레코드를 남겨야 한다.
// 한 곳만 고치면 siteId 없는 레코드가 덮어써져 initialJiraFields의 sameSite 게이트가 **무음으로**
// 사라진다 — 그래서 design §9이 "반드시 함께"라고 못박았다. 두 다이얼로그는 렌더 테스트 비용이
// 크고(제출까지 태우려면 캡처·업로드 전부를 모킹해야 한다) e2e는 IssueCreateModal 경로만 태우므로,
// 소스 스캔으로 고정한다(builderLocaleWrap.test.ts와 같은 계열의 그물).
//
// **2026-08-14 — 스캔 대상이 두 컴포넌트에서 어댑터 한 곳으로 바뀌었다.** 인자 매핑을
// submitAdapters.ts로 모은 뒤로는 두 진입점이 같은 함수를 부르므로 대칭이 구조적으로 보장된다
// (한쪽만 고치는 것이 불가능하다). 그래서 "두 파일이 같은 키를 쓴다"가 아니라 **"어댑터가 5키를
// 다 싣는다"**로 축소했다 — 단언은 약해졌지만 그것이 지키던 실패 모드는 코드 형태가 없앴다.
// 어댑터의 반환 타입이 명시돼 있어 키 오타는 typecheck가 잡고, 값 매핑은 submitAdapters.test.ts가
// toEqual로 고정한다. 이 파일은 "sticky 키가 매핑에서 통째로 빠지는" 축만 남는다.
const ADAPTERS = "src/sidepanel/lib/submitAdapters.ts";
const ENTRY_POINTS = [
  "src/sidepanel/tabs/IssueCreateModal.tsx",
  "src/sidepanel/tabs/DraftDetailDialog.tsx",
] as const;

// 유효 프로젝트는 이번 제출의 필드값이고 계정 설정은 fallback일 뿐이다 — 아래 5개가 빠지면
// sticky(프로젝트·이슈타입)와 사이트 판별자가 죽는다. 스프린트도 같은 sticky 계열이라
// 한쪽만 기록하면 재제출 경로에서 조용히 값을 잃는다.
const REQUIRED_KEYS = [
  "projectKey",
  "issueTypeId",
  "siteId",
  "sprintId",
  "sprintName",
] as const;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// 지목한 마커 뒤 첫 중괄호 블록을 잘라낸다 — 호출 인자 리터럴과 함수 본문 둘 다 받는다.
function objectLiteralAfter(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `${marker} 호출을 못 찾았다`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("payload 리터럴이 닫히지 않았다");
}

function lastSubmitPayload(src: string): string {
  return objectLiteralAfter(src, "): JiraLastSubmitFields {");
}

describe("Jira 제출 진입점 대칭", () => {
  it("어댑터의 lastSubmitFields 매핑이 sticky 키를 모두 싣는다", () => {
    const payload = lastSubmitPayload(source(ADAPTERS));
    for (const key of REQUIRED_KEYS) {
      expect(payload, `${key}가 빠졌다`).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  // siteId는 계정 auth에서 파생해야 한다 — 상수나 다른 출처면 게이트가 공허해진다. 파생 자체는
  // 어댑터 밖(진입점)에 남으므로 두 진입점을 보되, **어댑터 인자 리터럴 안**으로 범위를 좁힌다 —
  // 파일 전문을 보면 markSubmitted의 `jiraSiteId: jiraSiteId(...)`가 오탐으로 통과시킨다.
  it.each(ENTRY_POINTS)("%s가 siteId를 계정 auth에서 파생한다", (path) => {
    expect(objectLiteralAfter(source(path), "jiraLastSubmitFields({"))
      .toMatch(/siteId:\s*jiraSiteId\(/);
  });

  // 기록만 하고 제출에 안 실으면 다음 다이얼로그엔 남는데 이번 이슈엔 안 붙는다.
  it("어댑터의 submitArgs 매핑이 sprintId를 싣는다", () => {
    expect(objectLiteralAfter(source(ADAPTERS), "): JiraSubmitInput {")).toMatch(
      /\bsprintId\b/,
    );
  });

  // 제출 payload와 lastSubmitFields 둘 다 계정 설정이 아니라 유효 프로젝트를 써야 한다.
  it.each(ENTRY_POINTS)("%s가 계정 기본 프로젝트를 제출에 직접 쓰지 않는다", (path) => {
    expect(source(path)).not.toMatch(/projectKey:\s*jiraAccount[?.]*\.projectKey/);
  });
});

// 제출 분석은 성공·실패 두 지점에서 같은 함수를 부른다. 인자가 전부 boolean|null 위치
// 인자라 한쪽만 빠뜨리거나 순서가 어긋나도 타입이 못 잡고, Jira 축 3개는 목록 조회 실패를
// 삼키는 설계의 유일한 사후 관측 수단이라 뒤집혀도 알 방법이 없다.
describe("제출 분석 축 대칭", () => {
  const DIALOG = "src/sidepanel/tabs/SubmitFieldsDialog.tsx";

  function trackSubmitArgs(src: string): string[][] {
    return [...src.matchAll(/trackSubmit\(([\s\S]*?)\);/g)].map((m) =>
      m[1]
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    );
  }

  // 앞 5개는 두 호출이 원래 다르다(result 문자열, 그리고 편집기 상태를 읽는 변수명이 갈린다).
  // 뒤쪽 Jira 축 3개만 대조하고, 순서 자체는 track-submit.test.ts가 시그니처→property 매핑으로
  // 고정한다 — 두 그물의 조합이라야 뒤바뀐 인자가 red가 된다.
  it("성공·실패 두 호출이 같은 개수의 인자를 넘기고 뒤쪽 Jira 축이 일치한다", () => {
    const calls = trackSubmitArgs(source(DIALOG));

    expect(calls).toHaveLength(2);
    const [fail, ok] = calls;
    expect(fail).toHaveLength(ok.length);
    expect(fail.slice(5)).toEqual(ok.slice(5));
  });

  it("두 호출 모두 sprint 축 2개를 마지막에 싣는다", () => {
    for (const call of trackSubmitArgs(source(DIALOG))) {
      expect(call.slice(-2)).toEqual(["sprintFieldShown", "sprintSelected"]);
    }
  });
});

