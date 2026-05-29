import { describe, expect, it } from "vitest";
import { connectMethods, pickInitialSubTab } from "../integrationsTabUtils";

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
