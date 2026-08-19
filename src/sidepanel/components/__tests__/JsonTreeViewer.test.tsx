import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JsonTreeViewer } from "../JsonTreeViewer";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

describe("JsonTreeViewer — mono 표면", () => {
  it("트리 래퍼가 font-mono·text-mono다", () => {
    const { container } = render(<JsonTreeViewer data={{ a: 1, b: "x" }} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("font-mono");
    expect(wrapper.className).toContain("text-mono");
  });

  it("행에 임의 크기 클래스가 남지 않는다(래퍼 text-mono 상속)", () => {
    const { container } = render(
      <JsonTreeViewer data={{ a: 1, b: "x", c: { d: true } }} defaultExpandDepth={2} />,
    );
    expect(container.innerHTML).not.toContain("text-[13px]");
    expect(container.innerHTML).not.toContain("text-xs");
  });
});

// chevron은 DomTreeDialog와 className이 바이트 동일한 쌍둥이라 공용 컴포넌트로 뺀다.
// 이식 중에 접근성 속성이 한쪽에서 떨어지지 않도록 여기서 잠근다.
describe("JsonTreeViewer — chevron 펼침 상태", () => {
  function chevron(): HTMLElement {
    const el = document.querySelector("button[aria-expanded]");
    if (!el) throw new Error("chevron not found");
    return el as HTMLElement;
  }

  it("chevron이 aria-expanded를 갖는다", () => {
    render(<JsonTreeViewer data={{ a: { b: 1 } }} defaultExpandDepth={0} />);

    expect(chevron().getAttribute("aria-expanded")).toBe("false");
  });

  it("클릭하면 aria-expanded가 뒤집힌다", async () => {
    render(<JsonTreeViewer data={{ a: { b: 1 } }} defaultExpandDepth={0} />);

    await userEvent.click(chevron());

    expect(chevron().getAttribute("aria-expanded")).toBe("true");
  });

  it("접근명이 펼침/접힘에 따라 갈린다", async () => {
    render(<JsonTreeViewer data={{ a: { b: 1 } }} defaultExpandDepth={0} />);
    expect(chevron().getAttribute("aria-label")).toBe("common.expand");

    await userEvent.click(chevron());

    expect(chevron().getAttribute("aria-label")).toBe("common.collapse");
  });
});

// `<div onClick>`·`<span onClick>`은 Tab으로 도달할 수도, Enter/Space로 누를 수도 없다.
// 한 컴포넌트 안에 쌍둥이가 둘이라 하나만 고치면 접근성이 갈린다.
describe("JsonTreeViewer — 클릭 요소 키보드 접근", () => {
  const longArray = Array.from({ length: 60 }, (_, i) => `item-${i}`);

  it("'더 보기'가 button이고 Enter로 다음 청크를 연다", async () => {
    render(<JsonTreeViewer data={longArray} defaultExpandDepth={2} />);
    const more = screen.getByRole("button", { name: /json\.moreItems/ });

    more.focus();
    await userEvent.keyboard("{Enter}");

    expect(screen.queryByText(/"item-50"/)).toBeTruthy();
  });

  it("'모두 보기'도 button이고 Space로 전문을 편다", async () => {
    const long = "x".repeat(400);
    render(<JsonTreeViewer data={{ s: long }} defaultExpandDepth={2} />);
    const showAll = screen.getByRole("button", { name: "json.showAll" });

    showAll.focus();
    await userEvent.keyboard(" ");

    expect(screen.queryByRole("button", { name: "json.showAll" })).toBeNull();
  });
});
