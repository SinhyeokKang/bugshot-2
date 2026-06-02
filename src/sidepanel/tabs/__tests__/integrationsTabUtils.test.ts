import { describe, expect, it } from "vitest";
import {
  connectMethods,
  orderAddPlatforms,
  pickInitialSubTab,
} from "../integrationsTabUtils";
import type { PlatformId } from "@/types/platform";

const ORDER: PlatformId[] = [
  "jira",
  "github",
  "linear",
  "gitlab",
  "notion",
  "asana",
];

describe("pickInitialSubTab", () => {
  it("연결 0개면 '플랫폼 추가'(add)로 진입한다", () => {
    expect(pickInitialSubTab(0)).toBe("add");
  });

  it("연결 1개면 '내 연동'(connected)으로 진입한다", () => {
    expect(pickInitialSubTab(1)).toBe("connected");
  });

  it("연결 여러 개여도 '내 연동'(connected)으로 진입한다", () => {
    expect(pickInitialSubTab(4)).toBe("connected");
  });
});

describe("connectMethods", () => {
  it("OAuth 가능하면 [oauth, token] 두 수단을 OAuth 우선으로 반환한다", () => {
    expect(connectMethods(true)).toEqual(["oauth", "token"]);
  });

  it("OAuth 불가면 토큰 수단만 반환한다", () => {
    expect(connectMethods(false)).toEqual(["token"]);
  });

  it("조회 중(null)이면 빈 배열을 반환한다 (버튼 비활성 근거)", () => {
    expect(connectMethods(null)).toEqual([]);
  });
});

describe("orderAddPlatforms", () => {
  it("모두 미연결이면 원래(bugshot) 순서를 유지한다", () => {
    expect(orderAddPlatforms(ORDER, () => false)).toEqual(ORDER);
  });

  it("연결된 플랫폼은 미연결보다 후순위로 밀린다", () => {
    const connected = new Set<PlatformId>(["jira", "linear"]);
    expect(orderAddPlatforms(ORDER, (id) => connected.has(id))).toEqual([
      "github",
      "gitlab",
      "notion",
      "asana",
      "jira",
      "linear",
    ]);
  });

  it("각 그룹 내부에서는 bugshot 순서를 유지한다 (안정 정렬)", () => {
    const connected = new Set<PlatformId>(["github", "asana"]);
    expect(orderAddPlatforms(ORDER, (id) => connected.has(id))).toEqual([
      "jira",
      "linear",
      "gitlab",
      "notion",
      "github",
      "asana",
    ]);
  });

  it("모두 연결이면 원래 순서를 유지한다", () => {
    expect(orderAddPlatforms(ORDER, () => true)).toEqual(ORDER);
  });
});
