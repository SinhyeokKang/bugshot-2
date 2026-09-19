import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { submitTabsLayout } from "../submitTabsLayout";

// 제출 다이얼로그의 탭 줄 배선을 조립해 본다. SubmitFieldsDialog 자체는 prop 표면이 커서
// 렌더 못 하고, 순수 테스트는 클래스 문자열만 봐서 "layout 결과를 먹이면 실제로 접히는가"를
// 못 본다. 픽셀(아이콘 잘림·스크롤 도달)은 jsdom 밖이라 e2e의 몫으로 남는다.
function Row({ count }: { count: number }) {
  const layout = submitTabsLayout(count);
  const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  return (
    <Tabs value="p1">
      <div className={layout.wrapperClass} data-testid="tabs-wrapper">
        <CollapsingTabsList className={layout.listClass} forceCollapsed={layout.forceCollapsed}>
          {ids.map((id) => (
            <TabsTrigger key={id} value={id} className={layout.triggerClass}>
              <TabLabel>{`label-${id}`}</TabLabel>
            </TabsTrigger>
          ))}
        </CollapsingTabsList>
      </div>
    </Tabs>
  );
}

describe("제출 다이얼로그 탭 줄 배선", () => {
  it("9개면 라벨이 전부 접히고 그리드가 사라진다", () => {
    render(<Row count={9} />);
    const labels = screen.getAllByText(/^label-p\d$/);
    expect(labels).toHaveLength(9);
    for (const label of labels) expect(label.className).toContain("hidden");
    expect(screen.getByRole("tablist").className).not.toMatch(/grid-cols-/);
  });

  it("9개면 래퍼가 스크롤 컨테이너가 된다", () => {
    render(<Row count={9} />);
    expect(screen.getByTestId("tabs-wrapper").className).toContain("overflow-x-auto");
  });

  it("8개면 그리드가 유지되고 래퍼는 스크롤 컨테이너가 아니다", () => {
    render(<Row count={8} />);
    expect(screen.getByRole("tablist").className).toContain("grid-cols-8");
    expect(screen.getByTestId("tabs-wrapper").className).not.toContain("overflow-x-auto");
  });

  it("8개면 라벨을 강제로 접지 않는다 — 폭이 되면 보여준다", () => {
    render(<Row count={8} />);
    expect(screen.getByText("label-p1").className).not.toContain("hidden");
  });
});
