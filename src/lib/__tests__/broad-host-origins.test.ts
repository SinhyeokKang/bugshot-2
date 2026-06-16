import { describe, it, expect } from "vitest";
import { BROAD_HOST_ORIGINS } from "../broad-host-origins";

// captureVisibleTab은 일반 host 권한(https://*/*)을 캡처 권한으로 인정하지 않고
// <all_urls>(또는 activeTab)만 받는다. 30s Replay 광역 권한이 cross-origin 캡처에
// 실효하려면 이 상수가 <all_urls>여야 한다. 값이 일반 패턴으로 되돌아가면 회귀다.
describe("BROAD_HOST_ORIGINS", () => {
  it("is exactly ['<all_urls>'] so captureVisibleTab works cross-origin", () => {
    expect(BROAD_HOST_ORIGINS).toEqual(["<all_urls>"]);
  });

  it("does not use plain host patterns (insufficient for captureVisibleTab)", () => {
    expect(BROAD_HOST_ORIGINS).not.toContain("https://*/*");
    expect(BROAD_HOST_ORIGINS).not.toContain("http://*/*");
  });
});
