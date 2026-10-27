import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import type { PrepareCaptureResponse } from "@/types/picker";

// Real picker token validation, append start, hold and capture shell; browser/IDB boundaries are mocked.

const PREP: PrepareCaptureResponse = {
  rect: { x: 10, y: 10, width: 100, height: 40 },
  viewport: { width: 800, height: 600 },
  scrollX: 0,
  scrollY: 0,
  contextSelector: null,
};

let openPrepare: () => void = () => {};
const prepareCapture = vi.fn(
  () =>
    new Promise<PrepareCaptureResponse>((resolve) => {
      openPrepare = () => resolve(PREP);
    }),
);

// 크롭까지 가지 않게 캡처 요청은 실패시킨다 — 순서만 본다(jsdom은 이미지를 디코드하지 않는다).
vi.mock("@/lib/bg-client", () => ({
  sendBg: vi.fn(async () => {
    throw new Error("stop before crop");
  }),
}));
vi.mock("@/store/blob-db", () => ({
  saveNetworkLog: vi.fn().mockResolvedValue(true),
  saveConsoleLog: vi.fn().mockResolvedValue(true),
  saveActionLog: vi.fn().mockResolvedValue(true),
  saveInlineImage: vi.fn().mockResolvedValue(true),
  dataUrlToBlob: vi.fn(() => new Blob()),
  getNetworkLog: vi.fn().mockResolvedValue(null),
  getConsoleLog: vi.fn().mockResolvedValue(null),
  getActionLog: vi.fn().mockResolvedValue(null),
  getVideoBlob: vi.fn().mockResolvedValue(null),
  pruneOrphanInlineImages: vi.fn().mockResolvedValue(undefined),
  saveVideoBlob: vi.fn().mockResolvedValue(true),
  deleteVideoBlob: vi.fn().mockResolvedValue(undefined),
  saveImageBlob: vi.fn().mockResolvedValue(true),
  deleteNetworkLog: vi.fn().mockResolvedValue(undefined),
  deleteConsoleLog: vi.fn().mockResolvedValue(undefined),
  deleteActionLog: vi.fn().mockResolvedValue(undefined),
  saveAttachmentBlob: vi.fn().mockResolvedValue(true),
  deleteAttachmentBlob: vi.fn().mockResolvedValue(undefined),
  deleteAttachmentBlobs: vi.fn().mockResolvedValue(undefined),
  rekeyAttachmentBlobs: vi.fn().mockResolvedValue(undefined),
  listSubmissionRecoveries: vi.fn().mockResolvedValue([]),
  getVideoBlobKeys: vi.fn().mockResolvedValue([]),
  getImageBlobKeys: vi.fn().mockResolvedValue([]),
  getNetworkLogKeys: vi.fn().mockResolvedValue([]),
  getConsoleLogKeys: vi.fn().mockResolvedValue([]),
  getActionLogKeys: vi.fn().mockResolvedValue([]),
  getAttachmentBlobKeys: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/sidepanel/recorder-control", () => ({
  clearNetworkRecorder: vi.fn(),
  clearConsoleRecorder: vi.fn(),
  clearActionRecorder: vi.fn(),
}));

const T = 7;
const PANEL = 9;

type Listener = (msg: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: Listener[] = [];
let token = "";
const tabs = new Map<number, { id: number; windowId: number; active: boolean }>();
const update = vi.fn(async (id: number) => {
  for (const t of tabs.values()) t.active = t.id === id;
  return { ...tabs.get(id)! };
});

const SELECTED = {
  type: "picker.selected",
  sessionId: "s1",
  source: "pick",
  payload: {
    selector: "#a",
    tagName: "div",
    classList: [],
    computedStyles: {},
    specifiedStyles: {},
    propSources: {},
    hasParent: true,
    hasChild: false,
    text: "",
    viewport: { width: 800, height: 600 },
  },
};

beforeEach(() => {
  vi.resetModules();
  listeners = [];
  tabs.clear();
  tabs.set(T, { id: T, windowId: 1, active: false });
  tabs.set(PANEL, { id: PANEL, windowId: 1, active: true });
  update.mockClear();
  prepareCapture.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      },
    },
    tabs: {
      getCurrent: vi.fn(async () => ({ ...tabs.get(PANEL)! })),
      get: vi.fn(async (id: number) => ({ ...tabs.get(id)!, url: "https://example.com" })),
      sendMessage: vi.fn(async (_id: number, message: { type: string; frameToken?: string }) => {
        if (message.type === "picker.start") token = message.frameToken!;
        if (message.type === "picker.prepareCapture") return prepareCapture();
        return undefined;
      }),
      update,
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      session: { QUOTA_BYTES: 10 * 1024 * 1024, getBytesInUse: vi.fn(async () => 0), get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const restores = () => update.mock.calls.filter(([id]) => id === PANEL).length;

it("rejects stale append tokens and holds the target until the real capture transaction finishes", async () => {
  const { useEditorStore } = await import("@/store/editor-store");
  const { usePickerMessages } = await import("../usePickerMessages");
  const { useTabModeHold } = await import("../useTabModeHold");
  const { startAdditionalElementShot, isCurrentPickerSession } = await import("@/sidepanel/picker-control");
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  renderHook(() => { usePickerMessages(T); useTabModeHold(T); });
  await act(async () => {});
  act(() => {
    useEditorStore.getState().startElementShot({ tabId: T, url: "https://example.com", title: "page" });
    useEditorStore.getState().onElementShot({ selector: "A", tagName: "DIV" }, "raw", PREP.viewport);
    useEditorStore.getState().setDraft({ title: "keep", sections: { description: "body" } });
  });
  await act(async () => { expect(await startAdditionalElementShot(T)).toBe("started"); });
  expect(isCurrentPickerSession(T, token)).toBe(true);
  await waitFor(() => expect(tabs.get(T)!.active).toBe(true));
  const baselineRestores = restores();
  const send = (sessionId: string) => act(() => {
    for (const listener of listeners) listener({ ...SELECTED, sessionId }, { tab: { id: T } as chrome.tabs.Tab, frameId: 0 });
  });
  send("stale-token");
  await act(async () => {});
  expect(prepareCapture).not.toHaveBeenCalled();
  expect(useEditorStore.getState().phase).toBe("picking");
  send(token);
  await waitFor(() => expect(prepareCapture).toHaveBeenCalledTimes(1));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(restores()).toBe(baselineRestores);
  expect(tabs.get(T)!.active).toBe(true);
  openPrepare();
  await waitFor(() => expect(useEditorStore.getState().phase).toBe("drafting"));
  await waitFor(() => expect(tabs.get(PANEL)!.active).toBe(true));
  expect(restores()).toBe(baselineRestores + 1);
  expect(useEditorStore.getState().elementShots?.map(shot => shot.raw)).toEqual(["raw"]);
  expect(useEditorStore.getState().draft?.title).toBe("keep");
  expect(isCurrentPickerSession(T, token)).toBe(false);
});
