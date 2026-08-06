import { describe, expect, it } from "vitest";
import { resolveCaptureViewport } from "../capture-viewport";

// 영상·30s Replay는 원래 chrome.tabs.get(tab.width/height)만 썼다 — 그대로 두면 모드 ON에서
// 영상 리포트의 Viewport만 브라우저 폭으로 남는다. 두 경로가 같은 폴백 규칙을 공유해야
// 한쪽만 고쳐지는 드리프트가 안 생긴다.
describe("resolveCaptureViewport", () => {
  it("getTopViewport 성공값을 그대로 쓴다", () => {
    expect(
      resolveCaptureViewport({ width: 390, height: 800 }, { width: 1512, height: 900 }),
    ).toEqual({ width: 390, height: 800 });
  });

  // host permission 실패·정책 차단 페이지에서 메타가 비면 안 된다.
  it("null이면 기존 chrome.tabs.get 값으로 폴백한다", () => {
    expect(resolveCaptureViewport(null, { width: 1512, height: 900 })).toEqual({
      width: 1512,
      height: 900,
    });
  });

  it("0×0 폴백도 그대로 유지한다 (탭 닫힘 경로의 기존 동작)", () => {
    expect(resolveCaptureViewport(null, { width: 0, height: 0 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});
