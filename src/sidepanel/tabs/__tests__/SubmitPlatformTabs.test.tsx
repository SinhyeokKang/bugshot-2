import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import type { PlatformId } from "@/types/platform";
import { SubmitPlatformTabs } from "../SubmitPlatformTabs";

// 여기서 고정되는 건 submitTabsLayout이 고른 listClass·triggerClass가 실제로 그 자리에
// 닿는지까지다. wrapperClass·forceCollapsed는 9탭에서만 값이 갈려 **이 파일이 못 잡는다** —
// 9탭 렌더는 PlatformId가 닫힌 union 8종이라 애초에 불가능하다. 그 둘의 클래스는
// submitTabsLayout.test.ts가 순수 단언으로, 픽셀(아이콘 잘림·스크롤 도달)은 9번째 플랫폼이
// 생긴 뒤 e2e가 첫 실측으로 잡는다.
const ALL: PlatformId[] = ["jira", "github", "linear", "notion", "gitlab", "asana", "clickup", "slack"];

function renderTabs(platforms: PlatformId[]) {
  return render(
    <Tabs value={platforms[0]}>
      <SubmitPlatformTabs availablePlatforms={platforms} />
    </Tabs>,
  );
}

describe("SubmitPlatformTabs", () => {
  it("연결된 플랫폼만 트리거로 그린다", () => {
    renderTabs(["jira", "slack"]);
    expect(screen.getByTestId("platform-tab-jira")).toBeTruthy();
    expect(screen.getByTestId("platform-tab-slack")).toBeTruthy();
    expect(screen.queryByTestId("platform-tab-github")).toBeNull();
  });

  it("8개까지는 트리거 수에 맞는 그리드가 리스트에 실제로 붙는다", () => {
    renderTabs(ALL);
    expect(screen.getByRole("tablist").className).toContain("grid-cols-8");
  });

  it("트리거 클래스가 각 트리거에 닿는다", () => {
    renderTabs(ALL);
    expect(screen.getByTestId("platform-tab-jira").className).toContain("min-w-0");
  });

  it.each([2, 5, 8])("%i개면 래퍼가 스크롤 컨테이너가 아니다", (n) => {
    const { container } = renderTabs(ALL.slice(0, n));
    expect(screen.getByRole("tablist").className).toContain(`grid-cols-${n}`);
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("8개까지는 라벨을 강제로 접지 않는다", () => {
    renderTabs(ALL);
    // jsdom은 레이아웃이 0이라 자동 측정이 항상 "안 넘침"이다. 여기서 보는 건 그 결과가
    // forceCollapsed로 덮이지 않는다는 것뿐.
    for (const label of screen.getAllByText(/^(Jira|GitHub|Linear|Notion|GitLab|Asana|ClickUp|Slack)$/)) {
      expect(label.className).not.toContain("hidden");
    }
  });
});
