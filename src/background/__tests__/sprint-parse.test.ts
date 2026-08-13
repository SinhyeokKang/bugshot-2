import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

import { mergeBoardSprints, pickSprintField } from "../jira-api";
import { isActiveSprint } from "@/lib/jira-sprint";
import type { JiraSprint } from "@/types/jira";

// 2026-08-13 실측(cloudId 5c399437-…, 프로젝트 FCLXP, 이슈타입 "버그") 응답의 축약본.
// 봉투 키가 `values`가 아니라 `fields`라는 사실이 이 픽스처의 존재 이유다 — 초안대로 `values`를
// 읽었으면 pickSprintField가 항상 null을 돌려 "스프린트 없는 프로젝트"와 구별 불가능한
// 무음 미노출이 됐다(design R3).
const CREATEMETA_FIXTURE = {
  fields: [
    {
      fieldId: "summary",
      name: "요약",
      schema: { type: "string", system: "summary" },
    },
    {
      fieldId: "customfield_10020",
      name: "Sprint",
      schema: {
        type: "array",
        items: "json",
        custom: "com.pyxis.greenhopper.jira:gh-sprint",
        customId: 10020,
      },
    },
    {
      fieldId: "customfield_10014",
      name: "Epic Link",
      schema: {
        type: "any",
        custom: "com.pyxis.greenhopper.jira:gh-epic-link",
        customId: 10014,
      },
    },
  ],
  total: 21,
};

describe("pickSprintField", () => {
  it("실측 createmeta 응답에서 gh-sprint 필드의 id와 배열 여부를 뽑는다", () => {
    expect(pickSprintField(CREATEMETA_FIXTURE)).toEqual({
      fieldId: "customfield_10020",
      isArray: true,
    });
  });

  it("gh-sprint 필드가 없으면 null", () => {
    expect(
      pickSprintField({ fields: [CREATEMETA_FIXTURE.fields[0]] }),
    ).toBeNull();
  });

  it("빈 필드 목록이면 null", () => {
    expect(pickSprintField({ fields: [] })).toBeNull();
  });

  // 마이그레이션 잔재로 gh-sprint 스키마 필드가 복수인 사이트가 있다. 어느 쪽이 맞는지
  // 판정할 근거가 클라이언트에 없으므로 우선순위 규칙을 발명하지 않고 첫 번째를 쓴다.
  it("후보가 2개면 첫 번째를 쓴다", () => {
    const res = {
      fields: [
        {
          fieldId: "customfield_10020",
          name: "Sprint",
          schema: {
            type: "array",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
        {
          fieldId: "customfield_10999",
          name: "Sprint (old)",
          schema: {
            type: "array",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
      ],
    };

    expect(pickSprintField(res)?.fieldId).toBe("customfield_10020");
  });

  it("schema가 없는 원소가 섞여도 크래시 없이 판정한다", () => {
    const res = {
      fields: [
        { fieldId: "customfield_10001", name: "No schema" },
        {
          fieldId: "customfield_10020",
          name: "Sprint",
          schema: {
            type: "array",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
      ],
    };

    expect(pickSprintField(res)).toEqual({
      fieldId: "customfield_10020",
      isArray: true,
    });
  });

  it("schema.type이 array가 아니면 isArray는 false", () => {
    const res = {
      fields: [
        {
          fieldId: "customfield_10020",
          name: "Sprint",
          schema: {
            type: "any",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
      ],
    };

    expect(pickSprintField(res)).toEqual({
      fieldId: "customfield_10020",
      isArray: false,
    });
  });
});

// R9: state를 union으로 좁히면 미지 값이 타입 위에서만 사라지고 런타임에서는 그대로 흘러
// 닫힌 스프린트가 유효로 샌다. 화이트리스트 통과만 유효로 본다.
describe("isActiveSprint", () => {
  it("active와 future만 통과한다", () => {
    expect(isActiveSprint("active")).toBe(true);
    expect(isActiveSprint("future")).toBe(true);
  });

  it("closed는 통과하지 못한다", () => {
    expect(isActiveSprint("closed")).toBe(false);
  });

  it("미지의 상태 문자열은 통과하지 못한다", () => {
    expect(isActiveSprint("unknown-future-value")).toBe(false);
  });

  it("빈 문자열은 통과하지 못한다", () => {
    expect(isActiveSprint("")).toBe(false);
  });
});

function sprint(
  id: number,
  name: string,
  state: string,
  boardId: number,
): JiraSprint {
  return { id, name, state, boardId };
}

describe("mergeBoardSprints", () => {
  it("보드가 하나면 그 목록을 그대로 주고 multiBoard는 false", () => {
    const out = mergeBoardSprints([
      { boardName: "WEB board", sprints: [sprint(1, "Sprint 1", "active", 10)] },
    ]);

    expect(out.multiBoard).toBe(false);
    expect(out.sprints).toHaveLength(1);
    expect(out.sprints[0].boardName).toBe("WEB board");
  });

  it("보드가 둘이면 multiBoard가 true", () => {
    const out = mergeBoardSprints([
      { boardName: "A", sprints: [sprint(1, "S1", "active", 10)] },
      { boardName: "B", sprints: [sprint(2, "S2", "active", 20)] },
    ]);

    expect(out.multiBoard).toBe(true);
    expect(out.sprints.map((s) => s.id)).toEqual([1, 2]);
  });

  // 같은 스프린트가 두 보드에 걸릴 수 있다. 먼저 온 보드의 이름을 남긴다.
  it("id가 겹치면 1건으로 합치고 먼저 온 보드명을 남긴다", () => {
    const out = mergeBoardSprints([
      { boardName: "먼저", sprints: [sprint(7, "Sprint 7", "active", 10)] },
      { boardName: "나중", sprints: [sprint(7, "Sprint 7", "active", 20)] },
    ]);

    expect(out.sprints).toHaveLength(1);
    expect(out.sprints[0].boardName).toBe("먼저");
  });

  it("active가 future보다 앞에 오고 같은 상태 안에서는 id 오름차순", () => {
    const out = mergeBoardSprints([
      {
        boardName: "A",
        sprints: [
          sprint(30, "future b", "future", 10),
          sprint(20, "active b", "active", 10),
          sprint(10, "future a", "future", 10),
        ],
      },
      { boardName: "B", sprints: [sprint(5, "active a", "active", 20)] },
    ]);

    expect(out.sprints.map((s) => s.id)).toEqual([5, 20, 10, 30]);
  });

  it("빈 입력이면 빈 목록에 multiBoard는 false", () => {
    expect(mergeBoardSprints([])).toEqual({ sprints: [], multiBoard: false });
  });
});
