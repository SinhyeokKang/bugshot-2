import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let locale = "en";
vi.mock("@/store/settings-ui-store", () => ({
  useSettingsUiStore: (sel: (s: { locale: string }) => unknown) => sel({ locale }),
}));

import { useDocumentLangEffect } from "../useDocumentLangEffect";

beforeEach(() => {
  locale = "en";
  document.documentElement.lang = "";
});

// index.html의 `lang`은 정적이라 로케일과 어긋난다 — 스크린리더 발음·폰트 선택·브라우저
// 번역 제안이 전부 이 속성을 본다.
describe("useDocumentLangEffect", () => {
  it("en이면 documentElement.lang이 en-US다", () => {
    renderHook(() => useDocumentLangEffect());
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("ko면 ko-KR이다", () => {
    locale = "ko";
    renderHook(() => useDocumentLangEffect());
    expect(document.documentElement.lang).toBe("ko-KR");
  });

  it("로케일을 바꾸면 따라 바뀐다", () => {
    const { rerender } = renderHook(() => useDocumentLangEffect());
    expect(document.documentElement.lang).toBe("en-US");

    locale = "ko";
    rerender();

    expect(document.documentElement.lang).toBe("ko-KR");
  });
});
