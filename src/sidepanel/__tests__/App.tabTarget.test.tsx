import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// App의 훅 호출은 early return 위에서 돈다 — 탭 모드인데 쿼리가 없으면 대상 선택 화면 뒤에서
// hold·port·레코더가 임의 탭에 붙지 않도록 훅에는 null tabId가 가야 한다.
// jsdom href는 http://localhost라 getURL을 그 origin 기준으로 맞춘다 — 파서는 panelBase와 같은 origin·path만 받는다.
let selfTab: { id: number } | null = { id: 9 };
let selfPending: Promise<{ id: number } | null> | null = null;
let boundTabId: number | null | undefined = 5;
vi.mock("@/sidepanel/tab-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sidepanel/tab-mode")>();
  return { ...actual, getSelfTab: () => selfPending ?? Promise.resolve(selfTab) };
});
vi.mock("../hooks/useBoundTabId", () => ({ useBoundTabId: () => boundTabId }));

const spies = vi.hoisted(() => ({
  editorSync: vi.fn((_id: number | null) => true),
  recorder: vi.fn((_id: number | null) => {}),
  picker: vi.fn((_id: number | null) => {}),
  hold: vi.fn((_id: number | null) => {}),
  tabState: vi.fn((_id: number | null | undefined) => ({ unsupported: false, url: null })),
  replay: vi.fn((_id: number | null, _e: boolean, _u: boolean) => ({
    isReady: false,
    isEncoding: false,
    bufferedSeconds: 0,
    capture: async () => {},
    resolveTrim: () => {},
  })),
}));
vi.mock("../hooks/useEditorSessionSync", () => ({ useEditorSessionSync: spies.editorSync }));
vi.mock("../hooks/useBackgroundRecorder", () => ({ useBackgroundRecorder: spies.recorder }));
vi.mock("../hooks/usePickerMessages", () => ({ usePickerMessages: spies.picker }));
vi.mock("../hooks/useTabModeHold", () => ({ useTabModeHold: spies.hold }));
vi.mock("../hooks/useTabSupport", () => ({ useBoundTabState: spies.tabState }));
vi.mock("../30s-replay/use-30s-replay", () => ({ use30sReplay: spies.replay }));
vi.mock("../hooks/useLivePageUrl", () => ({ useLivePageUrl: () => {} }));
vi.mock("../hooks/useThemeEffect", () => ({ useThemeEffect: () => {} }));
vi.mock("../hooks/useDocumentLangEffect", () => ({ useDocumentLangEffect: () => {} }));

vi.mock("../tabs/DebugTab", () => ({ DebugTab: () => <div data-testid="debug-tab-body" /> }));
vi.mock("../tabs/IntegrationsTab", () => ({ IntegrationsTab: () => null }));
vi.mock("../tabs/IssueListTab", () => ({ IssueListTab: () => null }));
vi.mock("../tabs/SettingsTab", () => ({ SettingsTab: () => null }));
vi.mock("../tabs/ReplayTrimDialog", () => ({ default: () => null }));
vi.mock("../components/OAuthExpiredDialog", () => ({ OAuthExpiredDialog: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/sidepanel/picker-control", () => ({ clearPicker: async () => {} }));

const chromeStub = () => ({
  runtime: {
    getURL: (path: string) => `${window.location.origin}/${path}`,
    connect: vi.fn(() => ({ onDisconnect: { addListener: vi.fn() }, disconnect: vi.fn() })),
  },
  tabs: {
    connect: vi.fn(() => ({ onDisconnect: { addListener: vi.fn() }, disconnect: vi.fn() })),
    query: vi.fn(async () => []),
    get: vi.fn(async (id: number) => ({ id, windowId: 1, url: window.location.href })),
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
  },
});

import App from "../App";

function setHref(search: string) {
  window.history.replaceState(null, "", `/src/sidepanel/index.html${search}`);
}

beforeEach(() => {
  vi.stubGlobal("chrome", chromeStub());
  selfTab = { id: 9 };
  selfPending = null;
  boundTabId = 5;
  for (const spy of Object.values(spies)) spy.mockClear();
  // jsdom의 location은 http://localhost라 패널 origin과 안 맞는다 — 판정 입력은 href만이다.
  setHref("");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mounted() {
  render(<App />);
  await act(async () => {});
  await act(async () => {});
}

function lastArg(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls[spy.mock.calls.length - 1]?.[0];
}

describe("App — 탭 모드 대상 선택 게이트", () => {
  it("탭 모드 + 쿼리 없음: 선택 화면만 그리고 Debug 본문·'캡처할 수 없습니다'는 안 그린다", async () => {
    await mounted();
    expect(screen.getByTestId("tab-target-picker")).toBeTruthy();
    expect(screen.queryByTestId("debug-tab-body")).toBeNull();
    expect(screen.queryByText(/캡처할 수 없습니다|Can't capture/)).toBeNull();
  });

  it("선택 화면 뒤에서 레코더·picker·hold·세션 동기화·리플레이는 null tabId를 받는다", async () => {
    await mounted();
    for (const spy of [spies.editorSync, spies.recorder, spies.picker, spies.hold, spies.tabState, spies.replay]) {
      expect(lastArg(spy)).toBeNull();
    }
    const chromeApi = chrome as unknown as ReturnType<typeof chromeStub>;
    expect(chromeApi.tabs.connect).not.toHaveBeenCalled();
    expect(chromeApi.runtime.connect).not.toHaveBeenCalled();
  });

  it("선택 화면에도 탭 모드 안내가 있다", async () => {
    await mounted();
    expect(screen.getByTestId("tab-mode-agent-hint")).toBeTruthy();
  });

  it("getSelfTab 대기 중에는 아무것도 그리지 않고 훅에도 null을 준다", async () => {
    let resolve!: (v: { id: number } | null) => void;
    selfPending = new Promise((r) => (resolve = r));
    setHref("?tabId=5");
    await mounted();
    expect(screen.queryByTestId("tab-target-picker")).toBeNull();
    expect(screen.queryByTestId("debug-tab-body")).toBeNull();
    for (const spy of [spies.recorder, spies.picker, spies.hold, spies.editorSync]) {
      expect(lastArg(spy)).toBeNull();
    }
    await act(async () => resolve({ id: 9 }));
    expect(screen.getByTestId("debug-tab-body")).toBeTruthy();
    expect(lastArg(spies.recorder)).toBe(5);
  });

  it("탭 모드 + 정수 쿼리: 정상 화면이고 훅이 그 tabId를 받는다", async () => {
    setHref("?tabId=5");
    await mounted();
    expect(screen.queryByTestId("tab-target-picker")).toBeNull();
    expect(screen.getByTestId("debug-tab-body")).toBeTruthy();
    expect(lastArg(spies.recorder)).toBe(5);
    expect(lastArg(spies.hold)).toBe(5);
    expect(screen.getByTestId("tab-mode-agent-hint")).toBeTruthy();
  });

  it("사이드패널(getSelfTab=null): 쿼리가 없어도 기존 바인딩 그대로 — 선택 화면·안내 없음", async () => {
    selfTab = null;
    await mounted();
    expect(screen.queryByTestId("tab-target-picker")).toBeNull();
    expect(screen.queryByTestId("tab-mode-agent-hint")).toBeNull();
    expect(screen.getByTestId("debug-tab-body")).toBeTruthy();
    expect(lastArg(spies.recorder)).toBe(5);
  });
});
