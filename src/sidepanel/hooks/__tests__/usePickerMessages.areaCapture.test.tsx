import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const captureTargetTab = vi.fn(async (_tabId: number, _reason?: string) => "data:image/png;base64,x");
vi.mock("@/sidepanel/capture", () => ({
  captureElementSnapshot: vi.fn(async () => null),
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
// 인라인 경로를 압축 없이 끝까지 태운다(jsdom엔 OffscreenCanvas가 없다).
vi.mock("@/sidepanel/lib/compactImage", () => ({
  shouldCompact: () => false,
  compactImage: vi.fn(),
}));
vi.mock("@/sidepanel/recorder-control", () => ({
  clearNetworkRecorder: vi.fn(),
  clearConsoleRecorder: vi.fn(),
  clearActionRecorder: vi.fn(),
}));

import { useEditorStore } from "@/store/editor-store";
import { usePickerMessages } from "../usePickerMessages";

type Listener = (msg: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: Listener[] = [];
const TAB = 3;

function deliver(msg: unknown) {
  for (const l of listeners) l(msg, { tab: { id: TAB } as chrome.tabs.Tab, frameId: 0 });
}

const AREA = {
  type: "picker.areaSelected",
  rect: { x: 0, y: 0, width: 50, height: 50 },
  viewport: { width: 800, height: 600 },
};

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  listeners = [];
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
      draft: { title: "", sections: {} },
    });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 10, close: () => {} })));
    vi.stubGlobal("crypto", { randomUUID: () => "abcdefgh-1234" });
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);

    await waitFor(() =>
      expect(useEditorStore.getState().draft?.sections["section-1"]).toContain("abcdefgh"),
    );
    expect(useEditorStore.getState().inlineCaptureTarget).toBeNull();
    expect(captureTargetTab).toHaveBeenCalledTimes(1);
    expect(captureTargetTab.mock.calls[0]?.[1] ?? "capture").toBe("capture");
  });
});
