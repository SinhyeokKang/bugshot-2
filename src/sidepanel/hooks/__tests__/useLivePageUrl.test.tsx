import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

import { useEditorStore } from "@/store/editor-store";
import { useLivePageUrl } from "../useLivePageUrl";

// 이 배선이 끊기면 리졸버·store·훅이 전부 green인 채로 기능만 죽는다.
describe("useLivePageUrl — 발행 배선", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });
  afterEach(cleanup);

  it("마운트 시 url을 store에 발행한다", () => {
    renderHook(() => useLivePageUrl("https://example.com/projects"));
    expect(useEditorStore.getState().livePageUrl).toBe("https://example.com/projects");
  });

  it("url이 바뀌면 다시 발행한다", () => {
    const { rerender } = renderHook(({ url }) => useLivePageUrl(url), {
      initialProps: { url: "https://example.com/projects" as string | null },
    });
    rerender({ url: "https://example.com/invite/tok" });
    expect(useEditorStore.getState().livePageUrl).toBe("https://example.com/invite/tok");
  });

  it("null도 발행한다 (판독 불가 → 리졸버가 세션 원점으로 폴백)", () => {
    const { rerender } = renderHook(({ url }) => useLivePageUrl(url), {
      initialProps: { url: "https://example.com/projects" as string | null },
    });
    rerender({ url: null });
    expect(useEditorStore.getState().livePageUrl).toBeNull();
  });

  // 같은 값 리렌더가 store write를 유발하면 세션 스냅샷 저장이 반복 예약된다.
  it("같은 url로 리렌더하면 store 상태 정체성이 유지된다", () => {
    const { rerender } = renderHook(({ url }) => useLivePageUrl(url), {
      initialProps: { url: "https://example.com/projects" as string | null },
    });
    const first = useEditorStore.getState();
    rerender({ url: "https://example.com/projects" });
    expect(useEditorStore.getState()).toBe(first);
  });
});
