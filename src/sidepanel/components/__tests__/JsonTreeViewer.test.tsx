import { render } from "@testing-library/react";
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
