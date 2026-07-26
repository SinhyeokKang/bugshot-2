import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTabSupport } from "../useTabSupport";

type UpdatedListener = (
  tabId: number,
  info: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
) => void;

let listeners: UpdatedListener[];
let get: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;

/** chrome.tabs.get이 돌려줄 url을 갈아끼운다. undefined = 판독 불가(chrome:// 실제 형태). */
function setTabUrl(url: string | undefined) {
  get.mockImplementation(() => Promise.resolve({ url } as chrome.tabs.Tab));
}

function emit(tabId: number, info: chrome.tabs.TabChangeInfo) {
  for (const l of [...listeners]) l(tabId, info, {} as chrome.tabs.Tab);
}

beforeEach(() => {
  listeners = [];
  get = vi.fn(() => Promise.resolve({ url: "https://example.com" } as chrome.tabs.Tab));
  removeListener = vi.fn((l: UpdatedListener) => {
    listeners = listeners.filter((x) => x !== l);
  });
  vi.stubGlobal("chrome", {
    tabs: {
      get,
      onUpdated: {
        addListener: (l: UpdatedListener) => listeners.push(l),
        removeListener,
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTabSupport — 초기 판정", () => {
  it("지원 URL이면 false", async () => {
    setTabUrl("https://example.com/page");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(false));
    expect(get).toHaveBeenCalledWith(1);
  });

  it("차단 호스트(웹스토어)면 true", async () => {
    setTabUrl("https://chromewebstore.google.com/detail/bugshot/abc");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("미지원 스킴(chrome://)이면 true", async () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  // chrome:// 탭은 host permission 밖이라 tab.url이 항상 빈다. 이 케이스가 프로덕션의
  // 실제 chrome:// 모양이므로, 빈 값을 "지원"으로 접으면 chrome:// 시나리오가 통째로 무효가 된다.
  it("tab.url이 undefined면 true (판독 불가 = 미지원)", async () => {
    setTabUrl(undefined);
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("tab.url이 빈 문자열이면 true", async () => {
    setTabUrl("");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("판정 진행 중에는 false (기존 UI 유지 — first-paint 단언 보호)", () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabSupport(1));
    expect(result.current).toBe(false);
  });
});

describe("useTabSupport — tabId 부재", () => {
  it("null이면 false이고 chrome.tabs.get을 호출하지 않는다", () => {
    const { result } = renderHook(() => useTabSupport(null));
    expect(result.current).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("undefined면 false이고 chrome.tabs.get을 호출하지 않는다", () => {
    const { result } = renderHook(() => useTabSupport(undefined));
    expect(result.current).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useTabSupport — 네비게이션 전이", () => {
  it("미지원 → 지원: info.url이 실려 오면 그것으로 재판정", async () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(true));

    setTabUrl("https://example.com");
    await act(async () => {
      emit(1, { url: "https://example.com", status: "loading" });
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  // changeInfo.url도 tab.url과 같은 host-permission 게이팅을 받으므로 지원 → chrome:// 전이에서는
  // info.url이 redact되어 도착하지 않는다. info.url만 보면 이 방향을 영구히 놓친다.
  it("지원 → 미지원: info.url 없이 info.status만 와도 tabs.get으로 재판정", async () => {
    setTabUrl("https://example.com");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(false));

    setTabUrl(undefined);
    await act(async () => {
      emit(1, { status: "complete" });
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("다른 tabId의 onUpdated는 무시한다", async () => {
    setTabUrl("https://example.com");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(false));

    setTabUrl("chrome://version");
    await act(async () => {
      emit(2, { url: "chrome://version", status: "complete" });
    });
    expect(result.current).toBe(false);
  });

  it("같은 tabId로 여러 번 발화해도 판정이 idempotent", async () => {
    setTabUrl("https://example.com");
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(false));

    setTabUrl(undefined);
    await act(async () => {
      emit(1, { status: "loading" });
      emit(1, { status: "complete" });
      emit(1, { status: "complete" });
    });
    await waitFor(() => expect(result.current).toBe(true));
  });
});

describe("useTabSupport — 실패·정리", () => {
  it("chrome.tabs.get이 reject하면 false로 접히고 예외가 새지 않는다", async () => {
    get.mockImplementation(() => Promise.reject(new Error("No tab with id")));
    const { result } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("언마운트 시 onUpdated 리스너를 해제한다", async () => {
    setTabUrl("https://example.com");
    const { unmount } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(listeners.length).toBe(1));
    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(listeners.length).toBe(0);
  });

  it("언마운트 후 도착한 onUpdated는 상태를 갱신하지 않는다", async () => {
    setTabUrl("https://example.com");
    const { result, unmount } = renderHook(() => useTabSupport(1));
    await waitFor(() => expect(result.current).toBe(false));
    unmount();
    setTabUrl(undefined);
    await act(async () => {
      emit(1, { status: "complete" });
    });
    expect(result.current).toBe(false);
  });
});
