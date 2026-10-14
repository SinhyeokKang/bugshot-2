import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const log: string[] = [];
let self: { id: number } | null = { id: 9 };
const holdTarget = vi.fn(async (tabId: number, reason: string) => {
  log.push(`hold:${tabId}:${reason}`);
  return async () => {
    log.push(`release:${reason}`);
  };
});

vi.mock("@/sidepanel/tab-mode", () => ({
  getSelfTab: async () => self,
  holdTarget: (tabId: number, reason: string) => holdTarget(tabId, reason),
}));

import { useEditorStore } from "@/store/editor-store";
import { useTabModeHold } from "../useTabModeHold";

const T = 7;

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  log.length = 0;
  holdTarget.mockClear();
  self = { id: 9 };
});

afterEach(() => cleanup());

async function mounted(tabId: number | null = T) {
  const r = renderHook(() => useTabModeHold(tabId));
  // getSelfTab 해소 후 구독이 붙는다.
  await act(async () => {});
  return r;
}

describe("useTabModeHold — 탭 모드 상태 hold", () => {
  it("picking 진입에서 hold, 이탈에서 release", async () => {
    await mounted();
    act(() => useEditorStore.setState({ phase: "picking" }));
    expect(log).toEqual([`hold:${T}:picking`]);

    act(() => useEditorStore.setState({ phase: "styling" }));
    await waitFor(() => expect(log).toEqual([`hold:${T}:picking`, "release:picking"]));
  });

  it("마운트 시 이미 picking이면 곧바로 hold", async () => {
    useEditorStore.setState({ phase: "picking" });
    await mounted();
    expect(log).toEqual([`hold:${T}:picking`]);
  });

  it("picking 안에서 다른 상태가 바뀌어도 hold를 다시 잡지 않는다", async () => {
    await mounted();
    act(() => useEditorStore.setState({ phase: "picking" }));
    act(() => useEditorStore.setState({ selection: null, tokens: [] }));
    expect(holdTarget).toHaveBeenCalledTimes(1);
  });

  it("인라인 캡처 대기(inlineCaptureTarget)에서 hold, 해제에서 release", async () => {
    useEditorStore.setState({ phase: "drafting" });
    await mounted();
    act(() => useEditorStore.getState().startInlineCapture("section-1"));
    expect(log).toEqual([`hold:${T}:inline`]);

    act(() => useEditorStore.getState().cancelInlineCapture());
    await waitFor(() => expect(log).toEqual([`hold:${T}:inline`, "release:inline"]));
  });

  it("capturing(영역 방식)은 hold하지 않는다", async () => {
    await mounted();
    act(() => useEditorStore.setState({ phase: "capturing" }));
    expect(holdTarget).not.toHaveBeenCalled();
  });

  it("언마운트하면 잡고 있던 hold를 놓는다", async () => {
    const r = await mounted();
    act(() => useEditorStore.setState({ phase: "picking" }));
    r.unmount();
    await waitFor(() => expect(log).toContain("release:picking"));
  });

  it("사이드패널(getSelfTab null)에선 아무것도 잡지 않는다", async () => {
    self = null;
    await mounted();
    act(() => useEditorStore.setState({ phase: "picking" }));
    act(() => useEditorStore.getState().startInlineCapture("section-1"));
    expect(holdTarget).not.toHaveBeenCalled();
  });

  it("바인딩된 탭이 없으면 아무것도 잡지 않는다", async () => {
    await mounted(null);
    act(() => useEditorStore.setState({ phase: "picking" }));
    expect(holdTarget).not.toHaveBeenCalled();
  });
});
