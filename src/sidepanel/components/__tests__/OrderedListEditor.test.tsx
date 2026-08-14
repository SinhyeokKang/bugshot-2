import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderedListEditor } from "../OrderedListEditor";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

// DESIGN §9: size="icon" 버튼은 텍스트가 없으므로 aria-label(또는 sr-only)을 붙인다.
// title만 있으면 브라우저에 따라 접근명이 되기도/안 되기도 한다 — 저장소 유일한 title-only였다.
describe("OrderedListEditor — 삭제 버튼 접근명", () => {
  it("삭제 버튼을 접근명으로 조회할 수 있다", () => {
    render(<OrderedListEditor value={"a\nb"} onChange={vi.fn()} placeholder="" />);

    expect(screen.getAllByRole("button", { name: "common.delete" })).toHaveLength(2);
  });

  // jsdom의 접근명 계산은 title로 폴백하므로 위 조회만으론 title-only도 통과한다.
  // §9가 요구하는 건 aria-label(또는 sr-only) 자체다 — 속성 존재를 따로 고정한다.
  it("aria-label을 직접 갖는다 (title 폴백에 기대지 않는다)", () => {
    render(<OrderedListEditor value={"a\nb"} onChange={vi.fn()} placeholder="" />);

    const [first] = screen.getAllByRole("button", { name: "common.delete" });
    expect(first.getAttribute("aria-label")).toBe("common.delete");
  });

  it("title도 그대로 남는다 (마우스 툴팁 보존)", () => {
    render(<OrderedListEditor value={"a\nb"} onChange={vi.fn()} placeholder="" />);

    const [first] = screen.getAllByRole("button", { name: "common.delete" });
    expect(first.getAttribute("title")).toBe("common.delete");
  });
});
