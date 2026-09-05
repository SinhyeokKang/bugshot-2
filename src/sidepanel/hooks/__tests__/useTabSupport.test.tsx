import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { useBoundTabState } from "../useTabSupport";

// 기존 케이스는 미지원 축만 본다 — 어댑터로 받아 시그니처 변경을 흡수한다.
const useTabUnsupported = (tabId: number | null | undefined) =>
  useBoundTabState(tabId).unsupported;

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

// 언마운트를 먼저 돌린다 — vitest는 afterEach를 등록 역순으로 실행하므로 setup-dom의
// cleanup보다 이 훅이 앞서고, unstub 후 언마운트되면 훅의 removeListener가 chrome을 못 찾는다.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useTabUnsupported — 초기 판정", () => {
  it("지원 URL이면 false", async () => {
    setTabUrl("https://example.com/page");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(false));
    expect(get).toHaveBeenCalledWith(1);
  });

  it("차단 호스트(웹스토어)면 true", async () => {
    setTabUrl("https://chromewebstore.google.com/detail/bugshot/abc");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("미지원 스킴(chrome://)이면 true", async () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  // chrome:// 탭은 host permission 밖이라 tab.url이 항상 빈다. 이 케이스가 프로덕션의
  // 실제 chrome:// 모양이므로, 빈 값을 "지원"으로 접으면 chrome:// 시나리오가 통째로 무효가 된다.
  it("tab.url이 undefined면 true (판독 불가 = 미지원)", async () => {
    setTabUrl(undefined);
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("tab.url이 빈 문자열이면 true", async () => {
    setTabUrl("");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("판정 진행 중에는 false (기존 UI 유지 — first-paint 단언 보호)", () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabUnsupported(1));
    expect(result.current).toBe(false);
  });
});

describe("useTabUnsupported — tabId 부재", () => {
  it("null이면 false이고 chrome.tabs.get을 호출하지 않는다", () => {
    const { result } = renderHook(() => useTabUnsupported(null));
    expect(result.current).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("undefined면 false이고 chrome.tabs.get을 호출하지 않는다", () => {
    const { result } = renderHook(() => useTabUnsupported(undefined));
    expect(result.current).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useTabUnsupported — 네비게이션 전이", () => {
  it("미지원 → 지원: info.url이 실려 오면 그것으로 재판정", async () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabUnsupported(1));
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
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(false));

    setTabUrl(undefined);
    await act(async () => {
      emit(1, { status: "complete" });
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("다른 tabId의 onUpdated는 무시한다", async () => {
    setTabUrl("https://example.com");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(false));

    setTabUrl("chrome://version");
    await act(async () => {
      emit(2, { url: "chrome://version", status: "complete" });
    });
    expect(result.current).toBe(false);
  });

  // url·status가 없는 changeInfo(title·favIconUrl·audible 등)는 URL을 바꾸지 않는다.
  it("url·status 없는 changeInfo는 재조회하지 않는다", async () => {
    setTabUrl("https://example.com");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(false));
    const before = get.mock.calls.length;

    await act(async () => {
      emit(1, { title: "새 제목" } as chrome.tabs.TabChangeInfo);
      emit(1, { favIconUrl: "https://example.com/f.ico" } as chrome.tabs.TabChangeInfo);
    });
    expect(get.mock.calls.length).toBe(before);
  });

  // 한 네비게이션이 onUpdated를 여러 번 발화시켜 classify가 겹친다. 늦게 도착한 옛 응답이
  // 최신 판정을 덮으면 지원 페이지에 안내가 굳고, 재판정 트리거가 onUpdated뿐이라 회복 수단이 없다.
  // 두 축을 함께 본다 — url 발행이 seq 가드 바깥으로 새면 옛 응답의 undefined가
  // 최신 URL을 지운 채 영구히 남는다(판정만 보면 green이라 안 걸린다).
  it("늦게 resolve된 옛 응답이 최신 판정·URL을 덮지 않는다", async () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useBoundTabState(1));
    await waitFor(() => expect(result.current.unsupported).toBe(true));

    let releaseStale: (tab: chrome.tabs.Tab) => void = () => {};
    get.mockImplementationOnce(
      () => new Promise<chrome.tabs.Tab>((resolve) => (releaseStale = resolve)),
    );

    await act(async () => {
      emit(1, { status: "loading" }); // 보류되는 옛 조회
    });

    setTabUrl("https://example.com");
    await act(async () => {
      emit(1, { status: "complete" }); // 새 조회 — 먼저 resolve
    });
    await waitFor(() => expect(result.current.unsupported).toBe(false));
    expect(result.current.url).toBe("https://example.com");

    // 이제 옛 조회가 미지원 스냅샷을 들고 뒤늦게 도착한다.
    await act(async () => {
      releaseStale({ url: undefined } as chrome.tabs.Tab);
    });
    expect(result.current.unsupported).toBe(false);
    expect(result.current.url).toBe("https://example.com");
  });

  it("같은 tabId로 여러 번 발화해도 판정이 idempotent", async () => {
    setTabUrl("https://example.com");
    const { result } = renderHook(() => useTabUnsupported(1));
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

describe("useTabUnsupported — 실패·정리", () => {
  // true를 먼저 만든 뒤 reject를 태운다 — 초기값이 false라 그냥 reject만 보면
  // "catch가 능동적으로 false로 접었다"와 "아무 일도 안 일어났다"를 구별할 수 없다.
  it("chrome.tabs.get이 reject하면 true였던 판정이 false로 접힌다", async () => {
    setTabUrl("chrome://version");
    const { result } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(true));

    get.mockImplementation(() => Promise.reject(new Error("No tab with id")));
    await act(async () => {
      emit(1, { status: "complete" });
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("언마운트 시 onUpdated 리스너를 해제한다", async () => {
    setTabUrl("https://example.com");
    const { unmount } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(listeners.length).toBe(1));
    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(listeners.length).toBe(0);
  });

  it("언마운트 후 도착한 onUpdated는 상태를 갱신하지 않는다", async () => {
    setTabUrl("https://example.com");
    const { result, unmount } = renderHook(() => useTabUnsupported(1));
    await waitFor(() => expect(result.current).toBe(false));
    unmount();
    setTabUrl(undefined);
    await act(async () => {
      emit(1, { status: "complete" });
    });
    expect(result.current).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  url 반환 — freeform 재현 환경 Page의 입력                            */
/* ------------------------------------------------------------------ */

// 판정과 같은 tabs.get 응답에서 나온다. 별도 훅으로 떼면 리스너·seq 가드가 복제되고
// 둘이 어긋날 수 있어, 한 응답에서 나온다는 사실 자체를 여기서 고정한다.
describe("useBoundTabState — url 반환", () => {
  it("마운트 시 현재 URL을 돌려준다", async () => {
    setTabUrl("https://example.com/projects");
    const { result } = renderHook(() => useBoundTabState(1));
    await waitFor(() => expect(result.current.url).toBe("https://example.com/projects"));
  });

  it("네비게이션마다 갱신된다", async () => {
    setTabUrl("https://example.com/projects");
    const { result } = renderHook(() => useBoundTabState(1));
    await waitFor(() => expect(result.current.url).toBe("https://example.com/projects"));

    setTabUrl("https://example.com/invite/tok?e=email-mismatch");
    await act(async () => {
      emit(1, { status: "complete" });
    });

    await waitFor(() =>
      expect(result.current.url).toBe("https://example.com/invite/tok?e=email-mismatch"),
    );
  });

  // 미지원 페이지에서 tab.url이 redact돼 undefined로 오는 경우. null이어야 리졸버가
  // 세션 원점으로 폴백한다(빈 Page 행 방지).
  it("URL을 못 읽으면 null", async () => {
    setTabUrl("https://example.com/projects");
    const { result } = renderHook(() => useBoundTabState(1));
    await waitFor(() => expect(result.current.url).toBe("https://example.com/projects"));

    setTabUrl(undefined);
    await act(async () => {
      emit(1, { status: "complete" });
    });

    await waitFor(() => expect(result.current.url).toBeNull());
  });

  // 탭이 닫혀 tabs.get이 throw한 경우. 마지막 값을 지우면 Page 행이 세션 원점으로
  // 되돌아가 오히려 더 틀리므로 유지한다.
  it("tabs.get이 실패하면 직전 URL을 유지한다", async () => {
    setTabUrl("https://example.com/projects");
    const { result } = renderHook(() => useBoundTabState(1));
    await waitFor(() => expect(result.current.url).toBe("https://example.com/projects"));

    get.mockImplementation(() => Promise.reject(new Error("No tab with id")));
    await act(async () => {
      emit(1, { status: "complete" });
    });

    expect(result.current.url).toBe("https://example.com/projects");
  });

  it("같은 URL이 반복 도착해도 상태 객체 정체성을 유지한다 (리렌더 접기)", async () => {
    setTabUrl("https://example.com/projects");
    const { result } = renderHook(() => useBoundTabState(1));
    await waitFor(() => expect(result.current.url).toBe("https://example.com/projects"));
    const first = result.current;

    await act(async () => {
      emit(1, { status: "complete" });
    });

    expect(result.current).toBe(first);
  });
});
