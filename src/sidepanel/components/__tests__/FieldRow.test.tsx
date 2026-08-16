import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldRow } from "../FieldRow";

describe("FieldRow", () => {
  it("htmlFor를 주면 라벨이 그 id의 입력에 연결된다", () => {
    render(
      <FieldRow label="토큰" htmlFor="pat-input">
        <input id="pat-input" />
      </FieldRow>,
    );

    expect(screen.getByLabelText("토큰")).toBe(
      document.getElementById("pat-input"),
    );
  });

  // htmlFor를 안 넘긴 기존 사용처(콤보박스 등)는 연결이 없는 게 정상이다. 이 케이스가 없으면
  // "label 요소가 있다"만 재는 셈이라 htmlFor 배선이 실제로 걸렸는지 구별하지 못한다.
  it("htmlFor가 없으면 연결되지 않는다", () => {
    render(
      <FieldRow label="프로젝트">
        <input id="project-input" />
      </FieldRow>,
    );

    expect(screen.queryByLabelText("프로젝트")).toBeNull();
    expect(screen.getByText("프로젝트")).toBeTruthy();
  });

  it("labelAction을 주면 라벨과 같은 행에 함께 렌더된다", () => {
    render(
      <FieldRow
        label="토큰"
        htmlFor="pat-input"
        labelAction={<a href="https://example.test">발급</a>}
      >
        <input id="pat-input" />
      </FieldRow>,
    );

    const label = screen.getByText("토큰");
    const action = screen.getByRole("link", { name: "발급" });

    expect(action.getAttribute("href")).toBe("https://example.test");
    expect(label.parentElement).toBe(action.parentElement);
  });

  it("labelAction이 없으면 라벨 옆에 아무것도 안 붙는다", () => {
    const { container } = render(
      <FieldRow label="프로젝트">
        <input />
      </FieldRow>,
    );

    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("required면 별표가 붙고, 아니면 안 붙는다", () => {
    const { rerender, container } = render(
      <FieldRow label="프로젝트" required>
        <input />
      </FieldRow>,
    );
    expect(container.textContent).toContain("*");

    rerender(
      <FieldRow label="프로젝트">
        <input />
      </FieldRow>,
    );
    expect(container.textContent).not.toContain("*");
  });

  it("labelTitle이 라벨의 title 속성으로 간다", () => {
    render(
      <FieldRow label="색" labelTitle="from .btn">
        <input />
      </FieldRow>,
    );

    expect(screen.getByText("색").getAttribute("title")).toBe("from .btn");
  });
});
