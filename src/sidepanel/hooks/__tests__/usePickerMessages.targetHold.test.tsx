import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const events: string[] = [];
const captureElementSnapshot = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const captureTargetTab = vi.fn(async (_tabId: number, _reason?: string) => "data:image/png;base64,x");
const holdTarget = vi.fn(async (tabId: number, reason: string) => {
  events.push(`hold:${tabId}:${reason}`);
  return async () => {
    events.push(`release:${reason}`);
  };
});

vi.mock("@/sidepanel/tab-mode", () => ({
  holdTarget: (tabId: number, reason: string) => {
    // 동기 호출 시점의 phase — styling 전이보다 먼저여야 before 구간이 끊기지 않는다.
    events.push(`call:${reason}:${phaseNow()}`);
    return holdTarget(tabId, reason);
  },
}));
vi.mock("@/sidepanel/capture", () => ({
  captureElementSnapshot: (...a: unknown[]) => captureElementSnapshot(...a),
  captureTargetTab: (tabId: number, reason?: string) => captureTargetTab(tabId, reason),
  cropImage: async () => "data:image/webp;base64,crop",
}));
vi.mock("@/sidepanel/picker-control", () => ({
  clearPicker: vi.fn(async () => {}),
  collectTokens: vi.fn(async () => []),
  getTopViewport: vi.fn(async () => null),
  isCurrentPickerSession: vi.fn(() => true),
  maybeSurfacePermissionExpired: () => false,
  rebroadcastSentinelsToFrame: vi.fn(),
  releaseDetachedSelection: vi.fn(async () => {}),
  restartPickerInFrame: vi.fn(async () => {}),
  resumeBufferedElement: vi.fn(async () => false),
  stopHoverAllFrames: vi.fn(async () => {}),
  stopPicker: vi.fn(async () => {}),
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
}));
vi.mock("@/sidepanel/recorder-control", () => ({
  clearNetworkRecorder: vi.fn(),
  clearConsoleRecorder: vi.fn(),
  clearActionRecorder: vi.fn(),
}));

import { useEditorStore, type BufferedElement } from "@/store/editor-store";
import { usePickerMessages } from "../usePickerMessages";

function phaseNow() {
  return useEditorStore.getState().phase;
}

type Listener = (msg: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: Listener[] = [];
const TAB = 3;

function deliver(msg: unknown) {
  for (const l of listeners) l(msg, { tab: { id: TAB } as chrome.tabs.Tab, frameId: 0 });
}

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

const AREA = {
  type: "picker.areaSelected",
  rect: { x: 0, y: 0, width: 50, height: 50 },
  viewport: { width: 800, height: 600 },
};

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  events.length = 0;
  listeners = [];
  holdTarget.mockClear();
  captureElementSnapshot.mockReset();
  captureTargetTab.mockClear();
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      },
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
});

function enterPicking(extra: Partial<ReturnType<typeof useEditorStore.getState>> = {}) {
  useEditorStore.setState({
    phase: "picking",
    captureMode: "element",
    target: { tabId: TAB, url: "https://example.com", title: "x" },
    ...extra,
  });
}

describe("before 캡처 hold — 요소 선택 수신 ~ before 완료", () => {
  it("styling 전이 전에 hold를 잡고, before 캡처가 끝난 뒤에야 놓는다", async () => {
    enterPicking();
    let finish!: (v: unknown) => void;
    captureElementSnapshot.mockImplementation(
      () =>
        new Promise((r) => {
          events.push("before:start");
          finish = r;
        }),
    );
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);

    expect(events[0]).toBe("call:before:picking");
    await waitFor(() => expect(events).toContain("before:start"));
    expect(useEditorStore.getState().phase).toBe("styling");
    expect(events).not.toContain("release:before");

    finish({ image: "data:image/webp;base64,b", context: null });
    await waitFor(() => expect(events).toContain("release:before"));
    expect(holdTarget).toHaveBeenCalledWith(TAB, "before");
    expect(events.filter((e) => e === "release:before")).toHaveLength(1);
  });

  it("before 캡처가 실패(null)해도 놓는다", async () => {
    enterPicking();
    captureElementSnapshot.mockResolvedValue(null);
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);

    await waitFor(() => expect(events).toContain("release:before"));
  });

  it("버퍼 재선택(before 생략)이면 잡은 hold를 곧바로 놓는다", async () => {
    const buffered: BufferedElement = {
      selector: "#a",
      tagName: "div",
      frameId: 0,
      selectionSnapshot: {
        classList: [],
        specifiedStyles: {},
        computedStyles: {},
        text: null,
        viewport: { width: 800, height: 600 },
        capturedAt: 0,
      },
      styleEdits: useEditorStore.getInitialState().styleEdits,
      beforeImage: null,
      afterImage: null,
    };
    enterPicking({ bufferedElements: [buffered] });
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);

    await waitFor(() => expect(events).toContain("release:before"));
    expect(captureElementSnapshot).not.toHaveBeenCalled();
  });

  it("요소 단일 캡처(screenshot 모드)는 before hold를 잡지 않는다 — 트랜잭션 hold만", async () => {
    enterPicking({ captureMode: "screenshot" });
    captureElementSnapshot.mockResolvedValue(null);
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);

    await waitFor(() => expect(captureElementSnapshot).toHaveBeenCalled());
    expect(holdTarget).not.toHaveBeenCalled();
  });
});

describe("영역·인라인 캡처는 hold된 캡처 요청을 쓴다", () => {
  it("영역 드래그 → area hold로 요청(사용자가 직접 대상에 가 있어도 끝나면 패널 복귀)", async () => {
    useEditorStore.setState({
      phase: "capturing",
      captureMode: "screenshot",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
    });
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);

    await waitFor(() => expect(useEditorStore.getState().phase).toBe("drafting"));
    expect(captureTargetTab).toHaveBeenCalledWith(TAB, "area");
  });

  it("인라인 영역 → 일반 캡처 hold(인라인 상태 hold가 활성화·복원을 맡는다)", async () => {
    useEditorStore.setState({
      phase: "drafting",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
      inlineCaptureTarget: "section-1",
    });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 10, close: () => {} })));
    vi.stubGlobal("crypto", { randomUUID: () => "abcdefgh-1234" });
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);

    await waitFor(() => expect(useEditorStore.getState().inlineCaptureTarget).toBeNull());
    expect(captureTargetTab).toHaveBeenCalledWith(TAB, undefined);
  });
});
