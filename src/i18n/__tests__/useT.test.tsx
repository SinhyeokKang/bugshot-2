import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useT } from "../index";

// t()와 useT()는 같은 조회를 각자 복제한다 — 폴백을 t()에만 넣으면 훅 경유 호출(=UI 대부분)
// 만 무방비로 남는다. 두 경로가 같은 lookup을 쓴다는 걸 훅 쪽에서도 고정한다.
// (jsdom 트랙인 이유: useT는 useSettingsUiStore 구독이라 React 렌더 컨텍스트가 필요하다.)
describe("useT — 미정의 키 폴백", () => {
  it("등록된 키는 그대로 번역한다", () => {
    const { result } = renderHook(() => useT());
    expect(result.current("common.cancel")).toBeTruthy();
    expect(result.current("common.cancel")).not.toBe("common.cancel");
  });

  it("미정의 키는 throw하지 않고 키 문자열을 돌려준다", () => {
    const { result } = renderHook(() => useT());
    expect(result.current("this.key.does.not.exist" as never)).toBe(
      "this.key.does.not.exist",
    );
  });

  it("params가 있어도 TypeError 없이 키 문자열을 돌려준다", () => {
    const { result } = renderHook(() => useT());
    expect(result.current("this.key.does.not.exist" as never, { n: 1 })).toBe(
      "this.key.does.not.exist",
    );
  });
});
