import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let locale = "en";
vi.mock("@/store/settings-ui-store", () => ({
  useSettingsUiStore: (sel: (s: { locale: string }) => unknown) => sel({ locale }),
}));

import { BCP47, LOCALES } from "@/i18n/locales";
import { useDocumentLangEffect } from "../useDocumentLangEffect";

beforeEach(() => {
  locale = "en";
  document.documentElement.lang = "";
});

// index.html의 `lang`은 정적이라 로케일과 어긋난다 — 스크린리더 발음·폰트 선택·브라우저
// 번역 제안이 전부 이 속성을 본다.
describe("useDocumentLangEffect", () => {
  // LOCALES 순회 — 새 로케일 등록이 <html lang> 동기화까지 자동으로 검사되게 한다.
  it.each(LOCALES)("%s이면 documentElement.lang이 BCP47 값이다", (loc) => {
    locale = loc;
    renderHook(() => useDocumentLangEffect());
    expect(document.documentElement.lang).toBe(BCP47[loc]);
  });

  it("로케일을 바꾸면 따라 바뀐다", () => {
    const { rerender } = renderHook(() => useDocumentLangEffect());
    expect(document.documentElement.lang).toBe("en-US");

    locale = "ko";
    rerender();

    expect(document.documentElement.lang).toBe("ko-KR");
  });
});
