import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import type { PlatformId } from "@/types/platform";
import { SubmitPlatformTabs } from "../SubmitPlatformTabs";

// 9번째 PlatformId("webhook")가 생기면서 wrapperClass·forceCollapsed 배선을 여기서 처음
// 잴 수 있게 됐다 — Task 0 시점엔 union이 8종이라 9탭 렌더 자체가 불가능해서 그 둘이
// 순수 단언으로만 남아 있었다. 남은 건 픽셀(아이콘 잘림·스크롤 도달)이고 그건 e2e 몫이다.
const ALL: PlatformId[] = [
  "jira", "github", "linear", "notion", "gitlab", "asana", "clickup", "slack", "webhook",
];
const EIGHT = ALL.slice(0, 8);

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
    renderTabs(EIGHT);
    expect(screen.getByRole("tablist").className).toContain("grid-cols-8");
  });

  it("트리거 클래스가 각 트리거에 닿는다", () => {
    renderTabs(EIGHT);
    expect(screen.getByTestId("platform-tab-jira").className).toContain("min-w-0");
  });

  it.each([2, 5, 8])("%i개면 래퍼가 스크롤 컨테이너가 아니다", (n) => {
    const { container } = renderTabs(ALL.slice(0, n));
    expect(screen.getByRole("tablist").className).toContain(`grid-cols-${n}`);
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("8개까지는 라벨을 강제로 접지 않는다", () => {
    renderTabs(EIGHT);
    // jsdom은 레이아웃이 0이라 자동 측정이 항상 "안 넘침"이다. 여기서 보는 건 그 결과가
    // forceCollapsed로 덮이지 않는다는 것뿐.
    for (const label of screen.getAllByText(/^(Jira|GitHub|Linear|Notion|GitLab|Asana|ClickUp|Slack)$/)) {
      expect(label.className).not.toContain("hidden");
    }
  });

  it("9탭이면 그리드를 버리고 래퍼가 가로 스크롤을 맡는다", () => {
    const { container } = renderTabs(ALL);
    expect(screen.getAllByRole("tab").length).toBe(9);
    expect(screen.getByRole("tablist").className).not.toMatch(/grid-cols-/);
    expect(container.querySelector(".overflow-x-auto")).toBeTruthy();
  });

  // 스크롤 목록은 셀 폭이 곧 콘텐츠 폭이라 자동 측정이 영원히 "안 넘침"으로 떨어진다 —
  // forceCollapsed가 없으면 라벨이 그대로 남아 9개가 옆으로 길게 늘어선다.
  it("9탭이면 라벨을 강제로 접는다", () => {
    renderTabs(ALL);
    expect(screen.getByText("Jira").className).toContain("hidden");
  });

  it("9탭 트리거는 줄어들지 않는다", () => {
    renderTabs(ALL);
    expect(screen.getByTestId("platform-tab-webhook").className).toContain("shrink-0");
  });
});
