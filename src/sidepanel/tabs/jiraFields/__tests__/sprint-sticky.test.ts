import { describe, expect, it } from "vitest";
import type { JiraSprint } from "@/types/jira";
import { resolveStickySprint } from "../sprint-sticky";

// 직전 제출에서 복원된 sprintId가 아직 유효한지 판정한다. 유효 상태를 화이트리스트로 통과시키는
// 쪽이라(닫힌 상태를 열거해 거르는 게 아니라) 미지 상태 문자열이 유효로 새지 않는다(R9).

function sprint(state: string, name = "Sprint 24"): JiraSprint {
  return { id: 42, name, state };
}

describe("resolveStickySprint", () => {
  it("복원된 sprintId가 없으면 할 일이 없다", () => {
    expect(resolveStickySprint({}, sprint("active"))).toBeNull();
  });

  it("조회 결과가 null이면 값을 비운다", () => {
    expect(
      resolveStickySprint({ sprintId: 42, sprintName: "Sprint 24" }, null),
    ).toEqual({ sprintId: undefined, sprintName: undefined });
  });

  it("닫힌 스프린트면 값을 비운다", () => {
    expect(
      resolveStickySprint(
        { sprintId: 42, sprintName: "Sprint 24" },
        sprint("closed"),
      ),
    ).toEqual({ sprintId: undefined, sprintName: undefined });
  });

  it("미지의 상태 문자열이면 값을 비운다", () => {
    expect(
      resolveStickySprint(
        { sprintId: 42, sprintName: "Sprint 24" },
        sprint("unknown-future-value"),
      ),
    ).toEqual({ sprintId: undefined, sprintName: undefined });
  });

  it("유효하고 이름도 그대로면 patch가 없다", () => {
    expect(
      resolveStickySprint(
        { sprintId: 42, sprintName: "Sprint 24" },
        sprint("active"),
      ),
    ).toBeNull();
  });

  it("future 스프린트도 유효로 본다", () => {
    expect(
      resolveStickySprint(
        { sprintId: 42, sprintName: "Sprint 24" },
        sprint("future"),
      ),
    ).toBeNull();
  });

  // 이름만 갱신한다 — sprintId를 다시 쓰면 상위가 불필요한 store write를 한 번 더 한다.
  it("유효하지만 이름이 바뀌었으면 이름만 갱신한다", () => {
    expect(
      resolveStickySprint(
        { sprintId: 42, sprintName: "Sprint 24" },
        sprint("active", "Sprint 24 (연장)"),
      ),
    ).toEqual({ sprintName: "Sprint 24 (연장)" });
  });

  it("저장된 이름이 없고 유효하면 이름을 채운다", () => {
    expect(
      resolveStickySprint({ sprintId: 42 }, sprint("active")),
    ).toEqual({ sprintName: "Sprint 24" });
  });
});
