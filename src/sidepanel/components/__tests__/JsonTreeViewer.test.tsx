import { render } from "@testing-library/react";
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
