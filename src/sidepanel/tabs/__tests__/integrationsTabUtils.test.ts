import { describe, expect, it } from "vitest";
import {
  connectMethods,
  orderAddPlatforms,
  resolveEntrySubTab,
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

describe("resolveEntrySubTab — 연결 수 축", () => {
  it("연결 0개면 '플랫폼 추가'(add)로 진입한다", () => {
    expect(resolveEntrySubTab({ reconnect: null, connectedCount: 0 })).toBe("add");
  });

  it("연결 1개면 '내 연동'(connected)으로 진입한다", () => {
    expect(resolveEntrySubTab({ reconnect: null, connectedCount: 1 })).toBe(
      "connected",
    );
  });

  it("연결 여러 개여도 '내 연동'(connected)으로 진입한다", () => {
    expect(resolveEntrySubTab({ reconnect: null, connectedCount: 4 })).toBe(
      "connected",
    );
  });
});

// 진입 서브탭을 정하는 축이 둘이 됐다 — 기존 "연결 수가 0인가"와 새로 들어온 재연동 intent.
// 이걸 각자 effect로 두면 둘 다 상위 탭 전환 순간에 돌아 순서가 승부를 가른다(재연동은 정확히
// 그 순간에 도착한다). 판정을 한 함수로 모아 그 경합을 구조적으로 없앤다.
describe("resolveEntrySubTab", () => {
  it("재연동 intent가 없으면 기존 진입 규칙을 그대로 따른다", () => {
    expect(resolveEntrySubTab({ reconnect: null, connectedCount: 0 })).toBe("add");
    expect(resolveEntrySubTab({ reconnect: null, connectedCount: 2 })).toBe(
      "connected",
    );
  });

  // 재연동 버튼은 "플랫폼 추가" 목록에 있다. 연결 1개 이상이면 기존 규칙이 '내 연동'으로
  // 데려가므로, intent가 그걸 이겨야 사용자가 버튼을 다시 찾아 헤매지 않는다.
  it("재연동 intent가 있으면 연결 수와 무관하게 'add'로 간다", () => {
    expect(resolveEntrySubTab({ reconnect: "jira", connectedCount: 1 })).toBe("add");
    expect(resolveEntrySubTab({ reconnect: "jira", connectedCount: 8 })).toBe("add");
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
