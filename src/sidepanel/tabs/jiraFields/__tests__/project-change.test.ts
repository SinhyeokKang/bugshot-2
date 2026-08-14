import { describe, expect, it } from "vitest";
import { resolveProjectChange } from "../project-change";

// 프로젝트 전환 시 필드 정리 규칙의 단일 출처.
// 비움: 프로젝트 스코프에 묶인 값(이슈타입·담당자·상위 에픽·연결 이슈)
// 유지: 사이트 전역 값(우선순위·참조) — patch에 아예 넣지 않아 기존 값이 살아남는다.
// 담당자는 검색 API가 site-wide지만 배정 가능 여부가 프로젝트 권한에 묶여 비우는 쪽이다
// (JiraConnectForm.tsx:53-54 주석과 같은 근거).

// 스프린트는 보드에, 보드는 프로젝트에 묶이므로 프로젝트 스코프다.
const CLEARED = [
  "issueTypeId",
  "assigneeId",
  "assigneeName",
  "parentKey",
  "parentLabel",
  "relates",
  "sprintId",
  "sprintName",
] as const;

describe("resolveProjectChange", () => {
  it("다른 프로젝트로 바꾸면 프로젝트 스코프 8개를 undefined로 비운다", () => {
    const patch = resolveProjectChange({ projectKey: "WEB" }, "API");

    expect(patch.projectKey).toBe("API");
    for (const key of CLEARED) {
      expect(patch).toHaveProperty(key);
      expect(patch[key]).toBeUndefined();
    }
  });

  it("우선순위·참조는 patch에 넣지 않는다 (사이트 전역이라 기존 값 보존)", () => {
    const patch = resolveProjectChange({ projectKey: "WEB" }, "API");

    expect(patch).not.toHaveProperty("priorityId");
    expect(patch).not.toHaveProperty("priorityName");
    expect(patch).not.toHaveProperty("cc");
  });

  it("같은 프로젝트를 다시 고르면 projectKey만 있는 patch — 입력이 날아가지 않는다", () => {
    const patch = resolveProjectChange({ projectKey: "WEB" }, "WEB");

    expect(patch).toEqual({ projectKey: "WEB" });
  });

  it("현재 프로젝트가 비어 있으면(첫 선택) 전환으로 본다", () => {
    const patch = resolveProjectChange({}, "API");

    expect(patch.projectKey).toBe("API");
    for (const key of CLEARED) {
      expect(patch).toHaveProperty(key);
    }
  });
});
