import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import type { PrepareCaptureResponse } from "@/types/picker";

// 실제 hold 셸 + 실제 캡처 트랜잭션 + 실제 picking 상태 hold를 엮어, 요소 선택 → styling 전이 →
// before 캡처 완료 전까지 패널로 복원되지 않는지를 탭 상태로 본다(가짜는 chrome.tabs·content뿐).

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

vi.mock("@/sidepanel/picker-control", () => ({
  clearPicker: vi.fn(async () => {}),
  collectTokens: vi.fn(async () => []),
  endCapture: vi.fn(async () => {}),
  getTopViewport: vi.fn(async () => null),
  isCurrentPickerSession: vi.fn(() => true),
  maybeSurfacePermissionExpired: () => false,
  prepareCapture: () => prepareCapture(),
  prepareCaptureBySelector: vi.fn(async () => null),
  rebroadcastSentinelsToFrame: vi.fn(),
  releaseDetachedSelection: vi.fn(async () => {}),
  restartPickerInFrame: vi.fn(async () => {}),
  resumeBufferedElement: vi.fn(async () => false),
  stopHoverAllFrames: vi.fn(async () => {}),
  stopPicker: vi.fn(async () => {}),
}));
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
      get: vi.fn(async (id: number) => ({ ...tabs.get(id)! })),
      update,
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
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

describe("탭 모드 before 구간 — 실제 hold 셸·캡처 트랜잭션", () => {
  it("요소 선택 → styling 전이 뒤에도 before 캡처가 끝날 때까지 패널로 복원하지 않는다", async () => {
    const { useEditorStore } = await import("@/store/editor-store");
    const { usePickerMessages } = await import("../usePickerMessages");
    const { useTabModeHold } = await import("../useTabModeHold");
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    renderHook(() => {
      usePickerMessages(T);
      useTabModeHold(T);
    });
    await act(async () => {});

    act(() =>
      useEditorStore.setState({
        phase: "picking",
        captureMode: "element",
        target: { tabId: T, url: "https://example.com", title: "x" },
      }),
    );
    await waitFor(() => expect(tabs.get(T)!.active).toBe(true));

    act(() => {
      for (const l of listeners) l(SELECTED, { tab: { id: T } as chrome.tabs.Tab, frameId: 0 });
    });
    expect(useEditorStore.getState().phase).toBe("styling");
    await waitFor(() => expect(prepareCapture).toHaveBeenCalled());
    // picking release가 마이크로태스크들을 다 돈 뒤에도 before 트랜잭션이 대상을 잡고 있다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(restores()).toBe(0);
    expect(tabs.get(T)!.active).toBe(true);

    openPrepare();
    await waitFor(() => expect(tabs.get(PANEL)!.active).toBe(true));
    expect(restores()).toBe(1);
    await waitFor(() => expect(useEditorStore.getState().beforeCapturePending).toBe(false));
  });
});
