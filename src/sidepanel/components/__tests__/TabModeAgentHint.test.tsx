import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

let self: { id: number } | null = { id: 9 };
vi.mock("@/sidepanel/tab-mode", () => ({ getSelfTab: async () => self }));

import { TabModeAgentHint } from "../TabModeAgentHint";

afterEach(() => cleanup());

describe("TabModeAgentHint", () => {
  it("탭 모드에서 #__BUGSHOT_AGENT__ 리터럴이 든 안내를 보인다", async () => {
    self = { id: 9 };
    render(<TabModeAgentHint />);
    const hint = await screen.findByTestId("tab-mode-agent-hint");
    expect(hint.textContent).toContain("#__BUGSHOT_AGENT__");
    expect(hint.getAttribute("role")).toBeNull();
    expect(hint.getAttribute("aria-live")).toBeNull();
  });

  it("사이드패널(getSelfTab=null)에선 렌더하지 않는다 — 가드레일", async () => {
    self = null;
    const { container } = render(<TabModeAgentHint />);
    await act(async () => {});
    expect(screen.queryByTestId("tab-mode-agent-hint")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
