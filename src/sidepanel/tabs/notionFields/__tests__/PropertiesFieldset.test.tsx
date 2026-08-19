import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(" ")}` : key,
  t: (key: string) => key,
}));

import { PropertiesFieldset } from "../PropertiesFieldset";
import type { NotionDatabaseSchema } from "@/types/notion";

const SCHEMA = {
  selectProperties: [
    { id: "p1", name: "Priority", type: "select", options: ["High", "Low"] },
    { id: "p2", name: "Tags", type: "multi_select", options: ["a", "b"] },
  ],
} as unknown as NotionDatabaseSchema;

// FieldRow의 `<label>`은 htmlFor로 연결되지 않고, role="combobox" 버튼은 accname이 contents
// 우선이라 `<label for>`로는 이름이 안 붙는다(FieldCombobox.tsx가 이미 같은 결론에 도달했다).
// 그래서 트리거가 직접 접근 이름을 들어야 한다.
describe("PropertiesFieldset 접근 이름", () => {
  it("각 select 트리거가 속성명을 접근 이름으로 갖는다", () => {
    render(<PropertiesFieldset schema={SCHEMA} values={[]} onChange={() => {}} />);

    expect(screen.getByRole("combobox", { name: "Priority" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Tags" })).toBeTruthy();
  });

  it("속성명 라벨은 그대로 보인다", () => {
    render(<PropertiesFieldset schema={SCHEMA} values={[]} onChange={() => {}} />);

    expect(screen.getByText("Priority")).toBeTruthy();
    expect(screen.getByText("Tags")).toBeTruthy();
  });

  // 형제 폼이 gap-4인데 이 행만 gap-3이라 4px 좁았다.
  it("행 간격이 형제 폼과 같다 (gap-4)", () => {
    const { container } = render(
      <PropertiesFieldset schema={SCHEMA} values={[]} onChange={() => {}} />,
    );

    expect((container.firstElementChild as HTMLElement).className).toContain("gap-4");
  });
});
