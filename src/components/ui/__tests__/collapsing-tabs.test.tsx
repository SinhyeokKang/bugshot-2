import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollapsingTabsList, TabLabel } from "../collapsing-tabs";
import { Tabs, TabsTrigger } from "../tabs";

// jsdom은 레이아웃이 없어 clientWidth·scrollWidth가 전부 0이다 → 자동 측정은 항상
// "안 넘침"으로 떨어진다. 그래서 여기서 검증되는 건 자동 측정이 아니라 forceCollapsed
// 오버라이드가 그 결과를 덮는다는 사실뿐이고, 실제 접힘 임계값은 e2e·수동의 몫이다.
function Harness({ forceCollapsed }: { forceCollapsed?: boolean }) {
  return (
    <Tabs value="jira">
      <CollapsingTabsList forceCollapsed={forceCollapsed}>
        <TabsTrigger value="jira">
          <TabLabel>Jira</TabLabel>
        </TabsTrigger>
        <TabsTrigger value="github">
          <TabLabel>GitHub</TabLabel>
        </TabsTrigger>
      </CollapsingTabsList>
    </Tabs>
  );
}

describe("CollapsingTabsList forceCollapsed", () => {
  it("미지정이면 기존 동작 — jsdom 자동 측정 결과대로 라벨이 보인다", () => {
    render(<Harness />);
    expect(screen.getByText("Jira").className).not.toContain("hidden");
  });

  it("true면 자동 측정이 '안 넘침'이어도 모든 라벨을 접는다", () => {
    render(<Harness forceCollapsed />);
    expect(screen.getByText("Jira").className).toContain("hidden");
    expect(screen.getByText("GitHub").className).toContain("hidden");
  });

  it("prop이 DOM으로 새지 않는다 — React unknown-attribute 경고가 없다", () => {
    // React는 `attr={true}`를 조용히 떨구므로 속성 유무만으로는 누출을 못 잡는다.
    // 경고 자체를 그물로 쓴다.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness forceCollapsed />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("tablist").hasAttribute("forcecollapsed")).toBe(false);
    spy.mockRestore();
  });
});
