import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import { captureInactiveMessage } from "@/lib/capture-messages";

const sendBg = vi.fn<(...args: unknown[]) => Promise<string>>();
const cropImage = vi.fn(async () => "data:image/webp;base64,crop");
const captureElementSnapshot = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);

vi.mock("@/lib/bg-client", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));
vi.mock("@/sidepanel/capture", () => ({
  captureElementSnapshot: (...a: unknown[]) => captureElementSnapshot(...a),
  captureTargetTab: (tabId: number) => sendBg({ type: "captureVisibleTab", tabId }),
  cropImage: () => cropImage(),
}));
vi.mock("@/sidepanel/picker-control", async () => {
  const { isActiveTabPermissionError } = await import("@/sidepanel/lib/capture-error");
  return {
    clearPicker: vi.fn(async () => {}),
    collectTokens: vi.fn(async () => []),
    getTopViewport: vi.fn(async () => null),
    isCurrentPickerSession: vi.fn(() => true),
    maybeSurfacePermissionExpired: (err: unknown) => isActiveTabPermissionError(err),
    rebroadcastSentinelsToFrame: vi.fn(),
    releaseDetachedSelection: vi.fn(async () => {}),
    restartPickerInFrame: vi.fn(async () => {}),
    resumeBufferedElement: vi.fn(async () => false),
    stopHoverAllFrames: vi.fn(async () => {}),
    stopPicker: vi.fn(async () => {}),
  };
});
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

import { onCaptureFailed, onPickerPermissionExpired } from "@/lib/app-events";
import { setActiveTabExpiryDeferred } from "@/sidepanel/lib/capture-error";
import { useEditorStore } from "@/store/editor-store";
import { usePickerMessages } from "../usePickerMessages";

type Listener = (msg: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: Listener[] = [];
const failed = vi.fn();
let off: () => void = () => {};

const TAB = 3;
const AREA = {
  type: "picker.areaSelected",
  rect: { x: 0, y: 0, width: 50, height: 50 },
  viewport: { width: 800, height: 600 },
};

function deliver(msg: unknown) {
  for (const l of listeners) l(msg, { tab: { id: TAB } as chrome.tabs.Tab, frameId: 0 });
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  // 모듈 싱글턴이라 앞 케이스가 켠 지연 플래그가 다음 케이스로 샌다.
  setActiveTabExpiryDeferred(false);
  listeners = [];
  sendBg.mockReset();
  captureElementSnapshot.mockClear();
  failed.mockReset();
  off = onCaptureFailed.subscribe(failed);
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
    storage: {
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

afterEach(() => {
  cleanup();
  off();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function enterCapturing() {
  useEditorStore.setState({
    phase: "capturing",
    captureMode: "screenshot",
    target: { tabId: TAB, url: "https://example.com", title: "x" },
  });
}

describe("영역·뷰포트 캡처(captureAndCrop) 실패 발화", () => {
  it("관문 비활성 거부 → inactive 1회 + 기존 idle 리셋 유지", async () => {
    enterCapturing();
    sendBg.mockRejectedValue(new Error(captureInactiveMessage(TAB)));
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);

    await waitFor(() => expect(useEditorStore.getState().phase).toBe("idle"));
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("inactive");
  });

  // 캡처가 큐에서 기다리는 사이 사용자가 취소했으면 이미 떠난 세션이다 — 성공 결과를 버리는 것과 같은 규약.
  it("실패가 도착했을 때 세션이 바뀌었으면 발화하지 않는다", async () => {
    enterCapturing();
    let reject: (e: Error) => void = () => {};
    sendBg.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);
    await waitFor(() => expect(sendBg).toHaveBeenCalled());
    useEditorStore.getState().reset();
    reject(new Error(captureInactiveMessage(TAB)));

    await new Promise((r) => setTimeout(r, 0));
    expect(failed).not.toHaveBeenCalled();
  });

  it("권한 만료는 발화하지 않는다(다이얼로그 경로)", async () => {
    enterCapturing();
    sendBg.mockRejectedValue(
      new Error("Either the '<all_urls>' or 'activeTab' permission is required."),
    );
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);

    await waitFor(() => expect(useEditorStore.getState().phase).toBe("idle"));
    expect(failed).not.toHaveBeenCalled();
  });
});

describe("인라인 영역 캡처(captureAndInsertInline) 실패 발화", () => {
  it("실패 → other 1회 + 인라인 대기 해제 유지", async () => {
    useEditorStore.setState({
      phase: "drafting",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
      inlineCaptureTarget: "section-1",
    });
    sendBg.mockRejectedValue(new Error("No tab with id: 3."));
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);

    await waitFor(() => expect(useEditorStore.getState().inlineCaptureTarget).toBeNull());
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("other");
  });

  it("실패 도착 전에 인라인 캡처가 취소됐으면 발화하지 않는다", async () => {
    useEditorStore.setState({
      phase: "drafting",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
      inlineCaptureTarget: "section-1",
    });
    let reject: (e: Error) => void = () => {};
    sendBg.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderHook(() => usePickerMessages(TAB));

    deliver(AREA);
    await waitFor(() => expect(sendBg).toHaveBeenCalled());
    useEditorStore.getState().cancelInlineCapture();
    reject(new Error("No tab with id: 3."));

    await new Promise((r) => setTimeout(r, 0));
    expect(failed).not.toHaveBeenCalled();
  });
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

type SnapshotOpts = { isCurrent?: () => boolean };
function lastIsCurrent(): () => boolean {
  const opts = captureElementSnapshot.mock.calls.at(-1)?.[1] as SnapshotOpts | undefined;
  expect(typeof opts?.isCurrent).toBe("function");
  return opts!.isCurrent!;
}

// captureWithPrep이 발화 시점에 묻는 소유 판정 — 호출부의 stale 폐기 가드와 같은 술어여야 한다.
describe("요소 캡처 호출부가 소유 판정을 넘긴다", () => {
  it("before 캡처: 선택이 바뀌면 isCurrent가 false", async () => {
    useEditorStore.setState({
      phase: "picking",
      captureMode: "element",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
    });
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);
    await waitFor(() => expect(captureElementSnapshot).toHaveBeenCalled());
    const isCurrent = lastIsCurrent();

    expect(isCurrent()).toBe(true);
    useEditorStore.getState().reset();
    expect(isCurrent()).toBe(false);
  });

  it("요소 단일 캡처: picking을 떠나면 isCurrent가 false", async () => {
    useEditorStore.setState({
      phase: "picking",
      captureMode: "screenshot",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
    });
    // 캡처가 끝나면 실패 경로가 곧장 reset한다 — 판정만 보려고 캡처를 대기 상태로 둔다.
    captureElementSnapshot.mockReturnValueOnce(new Promise(() => {}));
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);
    await waitFor(() => expect(captureElementSnapshot).toHaveBeenCalled());
    const isCurrent = lastIsCurrent();

    expect(isCurrent()).toBe(true);
    useEditorStore.getState().reset();
    expect(isCurrent()).toBe(false);
  });
});

// captureWithPrep이 이미 발화한다(위 capture.test.ts) — 호출부가 null을 받고 또 발화하면 한 실패에 토스트가 둘이다.
describe("요소 캡처 호출부는 발화하지 않는다", () => {
  it("요소 단일 캡처 null → 발화 0 + idle 복귀", async () => {
    useEditorStore.setState({
      phase: "picking",
      captureMode: "screenshot",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
    });
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);

    await waitFor(() => expect(useEditorStore.getState().phase).toBe("idle"));
    expect(captureElementSnapshot).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("before 캡처 null → 발화 0 + styling 유지", async () => {
    useEditorStore.setState({
      phase: "picking",
      captureMode: "element",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
    });
    renderHook(() => usePickerMessages(TAB));

    deliver(SELECTED);

    await waitFor(() => expect(captureElementSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useEditorStore.getState().beforeCapturePending).toBe(false));
    expect(useEditorStore.getState().phase).toBe("styling");
    expect(useEditorStore.getState().beforeImage).toBeNull();
    expect(failed).not.toHaveBeenCalled();
  });
});

// background는 보존 phase에서 activeTab이 풀리면 다이얼로그를 idle까지 미룬다. 그 사이 실패는
// 같은 원인이라 토스트를 막고, idle 전이에서 다이얼로그만 한 번 뜬다.
describe("지연 권한 만료 플래그 배선", () => {
  const dialog = vi.fn();
  let offDialog: () => void = () => {};

  beforeEach(() => {
    dialog.mockReset();
    offDialog = onPickerPermissionExpired.subscribe(dialog);
  });

  afterEach(() => offDialog());

  async function failInlineCapture() {
    useEditorStore.setState({
      phase: "drafting",
      target: { tabId: TAB, url: "https://example.com", title: "x" },
      inlineCaptureTarget: "section-1",
    });
    sendBg.mockRejectedValue(new Error(captureInactiveMessage(TAB)));
    deliver(AREA);
    await waitFor(() => expect(useEditorStore.getState().inlineCaptureTarget).toBeNull());
  }

  it("지연 통지 뒤 캡처 실패는 토스트 0, idle 전이에서 다이얼로그 1회", async () => {
    renderHook(() => usePickerMessages(TAB));

    deliver({ type: "activeTabExpiredDeferred", tabId: TAB });
    await failInlineCapture();
    expect(failed).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();

    useEditorStore.getState().reset();
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it("다른 탭의 지연 통지는 무시한다 — 토스트는 뜨고 다이얼로그는 없다", async () => {
    renderHook(() => usePickerMessages(TAB));

    deliver({ type: "activeTabExpiredDeferred", tabId: TAB + 1 });
    await failInlineCapture();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("inactive");

    useEditorStore.getState().reset();
    expect(dialog).not.toHaveBeenCalled();
  });
});
