import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
// 뷰포트 행도 같은 이유로 스텁 — 실제 컴포넌트는 컨트롤러(chrome.runtime)까지 끌어온다.
// 여기서 고정하는 건 "행이 어느 조건에서 붙고 떨어지는가"뿐이다.
vi.mock("@/sidepanel/components/DeviceViewportBar", () => ({
  DeviceViewportBar: () => <div data-testid="stub-device-bar" />,
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

function renderDebug(unsupported: boolean) {
  return render(
    <TabSupportProvider value={unsupported}>
      <DebugTab activeMainTab="debug" />
    </TabSupportProvider>,
  );
}

beforeEach(() => {
  phase = "idle";
  syncNetworkRecorder.mockClear();
  syncConsoleRecorder.mockClear();
  syncActionRecorder.mockClear();
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

  it("녹화 중이면 기존 잠금이 그대로 동작 (회귀 방지)", () => {
    phase = "recording";
    renderDebug(false);
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

describe("DebugTab — 디바이스 뷰포트 행", () => {
  it("issue 서브탭에서 서브탭 바 안쪽에 붙는다", () => {
    renderDebug(false);
    const bar = screen.getByTestId("stub-device-bar");
    // 별도 bordered 행이면 상단 크롬이 커져 idle 화면이 잘린다 — 같은 wrapper 안이어야 한다.
    expect(bar.parentElement).toBe(trigger("subtab-issue").closest("div")?.parentElement);
  });

  it("콘솔·네트워크 서브탭으로 이동하면 행이 사라진다", async () => {
    renderDebug(false);
    await userEvent.click(trigger("subtab-console"));
    expect(screen.queryByTestId("stub-device-bar")).toBeNull();
    await userEvent.click(trigger("subtab-network"));
    expect(screen.queryByTestId("stub-device-bar")).toBeNull();
  });

  // hideSubTabs와 동일 조건 — 대신 작성 화면에는 device-viewport-indicator가 뜬다.
  it("drafting phase면 서브탭 바와 함께 행도 사라진다", () => {
    phase = "drafting";
    renderDebug(false);
    expect(screen.queryByTestId("stub-device-bar")).toBeNull();
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
