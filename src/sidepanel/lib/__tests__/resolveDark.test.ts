import { describe, expect, it } from "vitest";
import { resolveDark } from "../resolveDark";

// 다크 판정이 두 곳(사이드패널 useThemeEffect / picker-control이 content script에 실어보내는
// theme)으로 갈리면 페이지 위 인스펙터 카드만 앱과 다른 톤으로 뜬다. 판정식을 여기 한 벌로 묶는다.
describe("resolveDark", () => {
  it("theme=light면 OS가 다크여도 라이트다", () => {
    expect(resolveDark("light", true)).toBe(false);
  });

  it("theme=dark면 OS가 라이트여도 다크다", () => {
    expect(resolveDark("dark", false)).toBe(true);
  });

  it("theme=system은 OS 다크를 따른다", () => {
    expect(resolveDark("system", true)).toBe(true);
  });

  it("theme=system은 OS 라이트도 따른다", () => {
    expect(resolveDark("system", false)).toBe(false);
  });
});
