import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Tab = { id?: number; windowId?: number; url?: string; title?: string };

const PANEL_BASE = "chrome-extension://abc/src/sidepanel/index.html";
let tabs: Tab[] = [];
const listeners = {
  created: new Set<(tab: Tab) => void>(),
  removed: new Set<(id: number) => void>(),
  updated: new Set<(id: number, info: { url?: string; title?: string; status?: string }) => void>(),
};
const ev = <T,>(set: Set<T>) => ({
  addListener: (fn: T) => set.add(fn),
  removeListener: (fn: T) => set.delete(fn),
});

import { TabTargetPicker } from "../TabTargetPicker";

beforeEach(() => {
  tabs = [
    { id: 9, windowId: 1, url: PANEL_BASE, title: "BugShot" },
    { id: 21, windowId: 2, url: "https://other.example/a", title: "Other window" },
    { id: 11, windowId: 1, url: "https://app.example.com/page?x=1", title: "App page" },
    { id: 12, windowId: 1, url: "https://no-title.example.com/path", title: "" },
    { id: 13, windowId: 1, url: "chrome://settings", title: "Settings" },
  ];
  for (const set of Object.values(listeners)) set.clear();
  vi.stubGlobal("chrome", {
    runtime: { getURL: () => PANEL_BASE },
    tabs: {
      query: vi.fn(async () => tabs),
      get: vi.fn(async (id: number) => tabs.find((t) => t.id === id)),
      onCreated: ev(listeners.created),
      onRemoved: ev(listeners.removed),
      onUpdated: ev(listeners.updated),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mounted(navigate = vi.fn()) {
  const r = render(<TabTargetPicker selfTabId={9} navigate={navigate} />);
  await screen.findByTestId("tab-target-picker");
  await act(async () => {});
  return { ...r, navigate };
}

describe("TabTargetPicker — 대상 탭 후보", () => {
  it("self·미지원 URL을 빼고 같은 창 탭이 먼저 온다", async () => {
    await mounted();
    const rows = screen.getAllByTestId(/^tab-target-option-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "tab-target-option-11",
      "tab-target-option-12",
      "tab-target-option-21",
    ]);
  });

  it("제목과 URL 두 줄 — 제목이 없으면 hostname", async () => {
    await mounted();
    const withTitle = screen.getByTestId("tab-target-option-11");
    expect(within(withTitle).getByText("App page")).toBeTruthy();
    expect(within(withTitle).getByText("https://app.example.com/page?x=1")).toBeTruthy();
    const noTitle = screen.getByTestId("tab-target-option-12");
    expect(within(noTitle).getByText("no-title.example.com")).toBeTruthy();
    expect(within(noTitle).getByText("https://no-title.example.com/path")).toBeTruthy();
  });

  it("후보를 누르면 tabId가 박힌 패널 URL로 이동한다", async () => {
    const user = userEvent.setup();
    const { navigate } = await mounted();
    await user.click(screen.getByTestId("tab-target-option-11"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(`${PANEL_BASE}?tabId=11`);
  });

  it("후보가 없으면 empty 문구", async () => {
    tabs = [{ id: 9, windowId: 1, url: PANEL_BASE }];
    await mounted();
    expect(screen.getByTestId("tab-target-empty")).toBeTruthy();
    expect(screen.queryAllByTestId(/^tab-target-option-/)).toHaveLength(0);
  });

  it("onCreated 뒤 목록이 갱신된다", async () => {
    await mounted();
    tabs.push({ id: 30, windowId: 1, url: "https://new.example.com/", title: "Fresh" });
    for (const fn of listeners.created) fn(tabs[tabs.length - 1]);
    expect(await screen.findByTestId("tab-target-option-30")).toBeTruthy();
  });

  it("onRemoved 뒤 목록에서 빠진다", async () => {
    await mounted();
    tabs = tabs.filter((t) => t.id !== 11);
    for (const fn of listeners.removed) fn(11);
    await act(async () => {});
    expect(screen.queryByTestId("tab-target-option-11")).toBeNull();
  });

  it("onUpdated는 url·title이 바뀔 때만 다시 읽는다", async () => {
    await mounted();
    const query = chrome.tabs.query as ReturnType<typeof vi.fn>;
    const before = query.mock.calls.length;
    for (const fn of listeners.updated) fn(11, { status: "loading" });
    await act(async () => {});
    expect(query.mock.calls.length).toBe(before);

    tabs = tabs.map((t) => (t.id === 11 ? { ...t, title: "Renamed" } : t));
    for (const fn of listeners.updated) fn(11, { title: "Renamed" });
    expect(await screen.findByText("Renamed")).toBeTruthy();
  });

  it("언마운트하면 구독을 해제한다", async () => {
    const { unmount } = await mounted();
    unmount();
    expect(listeners.created.size).toBe(0);
    expect(listeners.removed.size).toBe(0);
    expect(listeners.updated.size).toBe(0);
  });
});
