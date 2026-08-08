import { describe, expect, it } from "vitest";
import { survivesTopNavigation } from "../top-nav-survival";

// `tabs.onUpdated(info.url)`은 top 문서에서만 온다 — 즉 이 이벤트가 왔다는 건 top 문서가
// 갈렸다는 뜻이고, 그 순간 하위 프레임(디바이스 뷰포트 래퍼·페이지 원래 iframe)은 전부
// 사라진다. 그런데 판정은 주소 비교 하나뿐이라, 주소가 같으면 세션이 살아남는다.
describe("survivesTopNavigation", () => {
  it("주소가 갈리면 프레임과 무관하게 못 살아남는다", () => {
    expect(survivesTopNavigation({ prevKey: "a.com/x", newKey: "a.com/y", selectionFrameId: 0 })).toBe(false);
    expect(survivesTopNavigation({ prevKey: "a.com/x", newKey: "a.com/y", selectionFrameId: 7 })).toBe(false);
  });

  it("top에서 고른 요소는 같은 주소 재로드를 넘어 살아남는다", () => {
    expect(survivesTopNavigation({ prevKey: "a.com/x", newKey: "a.com/x", selectionFrameId: 0 })).toBe(true);
    expect(survivesTopNavigation({ prevKey: "a.com/x", newKey: "a.com/x", selectionFrameId: undefined })).toBe(true);
  });

  // 핵심 회귀: 디바이스 뷰포트 ON에서 래퍼가 /detail을 보고 있으면 target.url도 /detail이다.
  // 주소창에 /detail을 넣어 top을 옮기면 두 키가 같아져 세션이 통과하는데, 래퍼는 사라졌고
  // selection.frameId는 죽은 프레임을 가리킨 채 남는다.
  it("하위 프레임에서 고른 요소는 주소가 같아도 못 살아남는다", () => {
    expect(survivesTopNavigation({ prevKey: "a.com/x", newKey: "a.com/x", selectionFrameId: 7 })).toBe(false);
  });

  // prevKey가 없으면 비교할 세션이 없다 — 호출부의 기존 조기 반환과 같은 결론.
  it("직전 주소를 모르면 판정하지 않고 유지한다", () => {
    expect(survivesTopNavigation({ prevKey: undefined, newKey: "a.com/y", selectionFrameId: 7 })).toBe(true);
  });
});
