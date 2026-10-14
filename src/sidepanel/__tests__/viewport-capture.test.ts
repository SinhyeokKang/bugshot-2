import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onCaptureFailed } from "@/lib/app-events";

const events: string[] = [];
const release = vi.fn(async () => {
  events.push("release");
});
const holdTarget = vi.fn(async (_tabId: number, reason: string) => {
  events.push(`hold:${reason}`);
  return release;
});
const captureFullViewport = vi.fn<(tabId: number) => Promise<boolean>>();

vi.mock("../tab-mode", () => ({
  holdTarget: (tabId: number, reason: string) => holdTarget(tabId, reason),
}));
vi.mock("../picker-control", () => ({
  captureFullViewport: (tabId: number) => captureFullViewport(tabId),
}));

const { useEditorStore } = await import("@/store/editor-store");
const { runViewportCapture } = await import("../viewport-capture");
const { setActiveTabExpiryDeferred } = await import("../lib/capture-error");

const TAB = 4;

function enterCapturing() {
  useEditorStore.setState({
    phase: "capturing",
    captureMode: "screenshot",
    target: { tabId: TAB, url: "https://example.com", title: "x" },
  });
}

describe("runViewportCapture — 뷰포트 버튼 ~ crop 완료 hold", () => {
  const failed = vi.fn();
  let off: () => void = () => {};

  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    setActiveTabExpiryDeferred(false);
    events.length = 0;
    release.mockClear();
    holdTarget.mockClear();
    captureFullViewport.mockReset();
    failed.mockReset();
    off = onCaptureFailed.subscribe((kind) => {
      events.push(`fail:${kind}:${useEditorStore.getState().phase}`);
      failed(kind);
    });
    enterCapturing();
  });

  afterEach(() => {
    off();
  });

  it("hold를 잡은 뒤 selectFullViewport를 보낸다", async () => {
    captureFullViewport.mockImplementation(async () => {
      events.push("select");
      return true;
    });
    await runViewportCapture(TAB);
    expect(holdTarget).toHaveBeenCalledWith(TAB, "viewport");
    expect(events.slice(0, 2)).toEqual(["hold:viewport", "select"]);
  });

  it("ok면 crop이 끝나 capturing을 벗어날 때까지 hold를 유지한다", async () => {
    captureFullViewport.mockResolvedValue(true);
    await runViewportCapture(TAB);
    expect(release).not.toHaveBeenCalled();

    useEditorStore.getState().onAreaCaptured("data:image/png;base64,x", { width: 800, height: 600 });
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(failed).not.toHaveBeenCalled();
  });

  it("!ok면 other 토스트 1회 → reset → release 순서", async () => {
    captureFullViewport.mockResolvedValue(false);
    await runViewportCapture(TAB);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("other");
    expect(useEditorStore.getState().phase).toBe("idle");
    expect(events).toEqual(["hold:viewport", "fail:other:capturing", "release"]);
  });

  it("응답 전에 사용자가 취소해 capturing을 벗어났으면 !ok여도 토스트 없이 release만", async () => {
    let resolve!: (ok: boolean) => void;
    captureFullViewport.mockImplementation(() => new Promise((r) => (resolve = r)));
    const run = runViewportCapture(TAB);
    await vi.waitFor(() => expect(captureFullViewport).toHaveBeenCalled());
    useEditorStore.getState().reset();
    resolve(false);
    await run;

    expect(failed).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("hold를 기다리는 사이 capturing을 벗어났으면 요청을 보내지 않는다", async () => {
    holdTarget.mockImplementationOnce(async (_t, reason) => {
      events.push(`hold:${reason}`);
      useEditorStore.getState().reset();
      return release;
    });
    await runViewportCapture(TAB);
    expect(captureFullViewport).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("content 송신이 throw해도 hold를 놓는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureFullViewport.mockRejectedValue(new Error("no receiver"));
    await runViewportCapture(TAB);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("release는 한 번만 — capturing 이탈과 !ok 경로가 겹쳐도", async () => {
    captureFullViewport.mockResolvedValue(false);
    await runViewportCapture(TAB);
    useEditorStore.setState({ phase: "drafting" });
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
    expect(release).toHaveBeenCalledTimes(1);
  });
});
