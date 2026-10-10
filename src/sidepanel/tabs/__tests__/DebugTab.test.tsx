import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));

// 서브탭 본체를 스텁으로 갈아 DebugTab 셸(sub 상태·잠금·폴링)만 검증한다 —
// 실제 IssueTab은 DraftingPanel·PreviewPanel·StyleEditorPanel(tiptap·sonner)까지 끌어온다.
vi.mock("../IssueTab", () => ({ IssueTab: () => <div data-testid="stub-issue" /> }));
vi.mock("../ConsoleSubTab", () => ({
  ConsoleSubTab: ({ active }: { active: boolean }) => (
    <div data-testid="stub-console" data-active={String(active)} />
  ),
}));
vi.mock("../NetworkSubTab", () => ({
  NetworkSubTab: ({ active }: { active: boolean }) => (
    <div data-testid="stub-network" data-active={String(active)} />
  ),
}));

const syncNetworkRecorder = vi.fn(() => Promise.resolve());
const syncConsoleRecorder = vi.fn(() => Promise.resolve());
const syncActionRecorder = vi.fn(() => Promise.resolve());
vi.mock("@/sidepanel/picker-control", () => ({
  startFreeformDraft: vi.fn(),
  syncNetworkRecorder: () => syncNetworkRecorder(),
  syncConsoleRecorder: () => syncConsoleRecorder(),
  syncActionRecorder: () => syncActionRecorder(),
}));

vi.mock("@/sidepanel/hooks/useBoundTabId", () => ({ useBoundTabId: () => 1 }));

let phase = "idle";
vi.mock("@/store/editor-store", () => ({
  useEditorStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ phase, consoleLog: undefined, networkLog: undefined }),
}));

import { DebugTab } from "../DebugTab";
import { TabSupportProvider } from "@/sidepanel/hooks/tab-support-context";

const trigger = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

const activeSub = () =>
  ["subtab-issue", "subtab-console", "subtab-network"].find(
    (id) => screen.getByTestId(id).getAttribute("data-state") === "active",
  );

function debugTree(unsupported: boolean, activeMainTab = "debug") {
  return (
    <TabSupportProvider value={unsupported}>
      <DebugTab activeMainTab={activeMainTab} />
    </TabSupportProvider>
  );
}

function renderDebug(unsupported: boolean, activeMainTab = "debug") {
  return render(debugTree(unsupported, activeMainTab));
}

// Radix Tabs는 mousedown에 활성화된다 — user-event click은 fake timers 아래서 hang한다.
const openSub = (id: string) => fireEvent.mouseDown(screen.getByTestId(id));

const clearSyncMocks = () => {
  syncNetworkRecorder.mockClear();
  syncConsoleRecorder.mockClear();
  syncActionRecorder.mockClear();
};

beforeEach(() => {
  phase = "idle";
  clearSyncMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DebugTab — 서브탭 잠금", () => {
  it("지원 페이지 + idle이면 console/network 트리거가 활성", () => {
    renderDebug(false);
    expect(trigger("subtab-console").disabled).toBe(false);
    expect(trigger("subtab-network").disabled).toBe(false);
  });

  it("미지원 페이지면 console/network 트리거가 disabled", () => {
    renderDebug(true);
    expect(trigger("subtab-console").disabled).toBe(true);
    expect(trigger("subtab-network").disabled).toBe(true);
  });

  it("녹화 중에도 console/network 트리거가 활성", () => {
    phase = "recording";
    renderDebug(false);
    expect(trigger("subtab-console").disabled).toBe(false);
    expect(trigger("subtab-network").disabled).toBe(false);
  });

  it("녹화 중 + 미지원 페이지면 여전히 disabled", () => {
    phase = "recording";
    renderDebug(true);
    expect(trigger("subtab-console").disabled).toBe(true);
    expect(trigger("subtab-network").disabled).toBe(true);
  });
});

describe("DebugTab — 미지원 전이 시 서브탭 복귀", () => {
  it("console 서브탭에 있다가 미지원으로 전이하면 issue로 돌아온다", async () => {
    const { rerender } = renderDebug(false);
    await userEvent.click(screen.getByTestId("subtab-console"));
    expect(activeSub()).toBe("subtab-console");
    expect(screen.getByTestId("stub-console").dataset.active).toBe("true");

    rerender(
      <TabSupportProvider value>
        <DebugTab activeMainTab="debug" />
      </TabSupportProvider>,
    );

    await waitFor(() => expect(activeSub()).toBe("subtab-issue"));
    // stale 로그가 언마운트된다(Radix가 비활성 TabsContent를 내린다) = 사용자가 안내에 도달한다.
    expect(screen.queryByTestId("stub-console")).toBeNull();
    expect(screen.getByTestId("stub-issue")).toBeTruthy();
  });

  it("지원 상태로 마운트하면 issue 서브탭이 기본 선택", () => {
    renderDebug(false);
    expect(activeSub()).toBe("subtab-issue");
  });
});

describe("DebugTab — 레코더 sync 폴링", () => {
  it("지원 페이지 + issue 서브탭이면 즉시 동기화하고 주기적으로 반복한다", async () => {
    vi.useFakeTimers();
    renderDebug(false);
    expect(syncNetworkRecorder).toHaveBeenCalledTimes(1);
    expect(syncConsoleRecorder).toHaveBeenCalledTimes(1);
    expect(syncActionRecorder).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(syncNetworkRecorder).toHaveBeenCalledTimes(2);
  });

  // 미지원 페이지에는 content script가 없어 1.5초마다 조용히 영구 실패한다(.catch(() => {})).
  it("미지원 페이지면 한 번도 동기화하지 않는다", async () => {
    vi.useFakeTimers();
    renderDebug(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncNetworkRecorder).not.toHaveBeenCalled();
    expect(syncConsoleRecorder).not.toHaveBeenCalled();
    expect(syncActionRecorder).not.toHaveBeenCalled();
  });

  it("다른 메인 탭이면 동기화하지 않는다 (회귀 방지)", async () => {
    vi.useFakeTimers();
    render(
      <TabSupportProvider value={false}>
        <DebugTab activeMainTab="settings" />
      </TabSupportProvider>,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncNetworkRecorder).not.toHaveBeenCalled();
  });
});

describe("DebugTab — 녹화 중 로그 서브탭", () => {
  it("녹화 중 console에서 drafting으로 바뀌면 issue로 돌아오고, 이어 idle이 돼도 issue에 머문다", () => {
    phase = "recording";
    const { rerender } = renderDebug(false);
    openSub("subtab-console");
    expect(activeSub()).toBe("subtab-console");

    phase = "drafting";
    rerender(debugTree(false));
    // drafting에선 hideSubTabs로 트리거가 없다 — 렌더된 서브탭 본체로 판정한다.
    expect(screen.queryByTestId("stub-console")).toBeNull();
    expect(screen.getByTestId("stub-issue")).toBeTruthy();

    phase = "idle";
    rerender(debugTree(false));
    expect(activeSub()).toBe("subtab-issue");
  });

  it("녹화 중 console에서 idle로 바뀌면(취소) console에 머문다", () => {
    phase = "recording";
    const { rerender } = renderDebug(false);
    openSub("subtab-console");

    phase = "idle";
    rerender(debugTree(false));
    expect(activeSub()).toBe("subtab-console");
  });
});

describe("DebugTab — 녹화 중 3종 폴링", () => {
  it("녹화 중이면 console 서브탭에서도 network·action을 주기 동기화한다", async () => {
    vi.useFakeTimers();
    phase = "recording";
    renderDebug(false);
    openSub("subtab-console");
    expect(activeSub()).toBe("subtab-console");
    clearSyncMocks();
    await vi.advanceTimersByTimeAsync(1500);
    expect(syncNetworkRecorder).toHaveBeenCalled();
    expect(syncActionRecorder).toHaveBeenCalled();
  });

  it("idle + console 서브탭이면 DebugTab은 동기화하지 않는다 (기존 동작)", async () => {
    vi.useFakeTimers();
    renderDebug(false);
    openSub("subtab-console");
    expect(activeSub()).toBe("subtab-console");
    clearSyncMocks();
    await vi.advanceTimersByTimeAsync(1500);
    expect(syncNetworkRecorder).not.toHaveBeenCalled();
    expect(syncActionRecorder).not.toHaveBeenCalled();
  });

  it("녹화 중이어도 다른 메인 탭이면 동기화하지 않는다", async () => {
    vi.useFakeTimers();
    phase = "recording";
    renderDebug(false, "settings");
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncNetworkRecorder).not.toHaveBeenCalled();
    expect(syncActionRecorder).not.toHaveBeenCalled();
  });

  it("녹화 중이어도 미지원 페이지면 동기화하지 않는다", async () => {
    vi.useFakeTimers();
    phase = "recording";
    renderDebug(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncNetworkRecorder).not.toHaveBeenCalled();
    expect(syncActionRecorder).not.toHaveBeenCalled();
  });

  // deps가 phase가 아니라 파생 불리언이어야 무관한 phase 전이마다 interval이 재시작되지 않는다.
  it("issue 서브탭에서 picking → capturing 전이는 동기화를 재시작하지 않는다", () => {
    vi.useFakeTimers();
    phase = "picking";
    const { rerender } = renderDebug(false);
    expect(syncNetworkRecorder).toHaveBeenCalledTimes(1);
    expect(syncActionRecorder).toHaveBeenCalledTimes(1);
    clearSyncMocks();
    phase = "capturing";
    rerender(debugTree(false));
    expect(syncNetworkRecorder).not.toHaveBeenCalled();
    expect(syncActionRecorder).not.toHaveBeenCalled();
  });
});
