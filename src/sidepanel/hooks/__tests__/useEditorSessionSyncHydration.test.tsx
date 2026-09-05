import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

// 훅 모듈이 닿는 picker/IDB/스토어 곁가지는 이 파일의 검증 대상이 아니다 —
// 여기서 보는 건 hydrate 게이트(반환 boolean)의 실패 경로뿐이다.
vi.mock("@/sidepanel/picker-control", () => ({
  cancelAreaSelect: vi.fn(),
  clearPicker: vi.fn(() => Promise.resolve()),
  rebindStylingSession: vi.fn(),
}));
vi.mock("@/store/blob-db", () => ({
  getNetworkLog: vi.fn().mockResolvedValue(null),
  getConsoleLog: vi.fn().mockResolvedValue(null),
  getActionLog: vi.fn().mockResolvedValue(null),
  getVideoBlob: vi.fn().mockResolvedValue(null),
  pruneOrphanInlineImages: vi.fn().mockResolvedValue(undefined),
  saveVideoBlob: vi.fn().mockResolvedValue(true),
  deleteVideoBlob: vi.fn().mockResolvedValue(undefined),
  saveImageBlob: vi.fn().mockResolvedValue(true),
  saveNetworkLog: vi.fn().mockResolvedValue(true),
  saveConsoleLog: vi.fn().mockResolvedValue(true),
  deleteNetworkLog: vi.fn().mockResolvedValue(undefined),
  deleteConsoleLog: vi.fn().mockResolvedValue(undefined),
  saveActionLog: vi.fn().mockResolvedValue(true),
  deleteActionLog: vi.fn().mockResolvedValue(undefined),
  dataUrlToBlob: vi.fn(() => new Blob()),
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
vi.mock("@/store/issues-store", () => ({
  useIssuesStore: {
    getState: () => ({
      saveDraft: vi.fn(),
      patchDraftSnapshot: vi.fn(),
      patchIssue: vi.fn(),
      patchDraftBufferedImageFlags: vi.fn(),
    }),
  },
}));
vi.mock("@/store/settings-store", () => ({
  useSettingsStore: { getState: () => ({ lastSubmitFields: {}, accounts: {} }) },
}));
vi.mock("@/lib/app-events", () => ({
  onBlobSaveFailed: { fire: vi.fn(), listen: vi.fn() },
  onSessionSaveExhausted: { fire: vi.fn(), listen: vi.fn() },
}));

import { useEditorStore } from "@/store/editor-store";
import { useEditorSessionSync } from "../useEditorSessionSync";

let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // 스토어는 모듈 싱글턴이라 케이스가 심은 값이 다음 케이스로 샌다(editor-store.test.ts 관용구).
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  get = vi.fn(() => Promise.resolve({}));
  set = vi.fn(() => Promise.resolve());
  vi.stubGlobal("chrome", {
    storage: {
      session: { get, set },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
});

// 언마운트를 unstub보다 먼저 — setup-dom의 cleanup은 afterEach 역순이라 뒤로 밀리고,
// chrome이 사라진 뒤 정리 콜백(flushPendingSave)이 돌면 훅이 죽는다.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// App.tsx의 `if (!editorHydrated) return null` 게이트가 이 반환값 하나에 걸려 있다 —
// false로 굳으면 사이드패널 전체가 빈 화면이 되고 복구 수단은 패널 재오픈뿐이다.
describe("useEditorSessionSync — hydrate 게이트", () => {
  it("tabId가 없으면 게이트를 막지 않는다", () => {
    const { result } = renderHook(() => useEditorSessionSync(null));
    expect(result.current).toBe(true);
  });

  it("저장분이 없어도 조회가 끝나면 게이트가 열린다", async () => {
    const { result } = renderHook(() => useEditorSessionSync(7));
    await waitFor(() => expect(result.current).toBe(true));
  });

  // 회귀: `.then`에만 setHydratedTabId가 있어 reject가 게이트를 영구히 닫았다.
  // 정책은 chrome-storage.ts의 chromeLocalStorage.getItem과 같다 — 조회 실패는
  // 기본값(빈 세션)으로 강등하고 화면은 띄운다.
  it("조회가 reject해도 게이트가 열린다", async () => {
    get.mockRejectedValue(new Error("storage unavailable"));
    const { result } = renderHook(() => useEditorSessionSync(7));
    await waitFor(() => expect(result.current).toBe(true));
  });

  // 기대값을 기본값(idle/null)으로 두면 "catch가 아무것도 안 한다"와 "catch가 스토어를
  // 강제 리셋한다"가 구분되지 않는다 — 진행 중인 세션을 심어두고 그게 살아남는지로 재야
  // "건드리지 않는다"를 실제로 증명한다.
  it("조회가 reject해도 진행 중 세션을 덮지 않는다", async () => {
    useEditorStore.setState({
      phase: "styling",
      target: { tabId: 7, url: "https://example.com", title: "example" },
    });
    get.mockRejectedValue(new Error("storage unavailable"));
    const { result } = renderHook(() => useEditorSessionSync(7));
    await waitFor(() => expect(result.current).toBe(true));
    expect(useEditorStore.getState().phase).toBe("styling");
    expect(useEditorStore.getState().target?.url).toBe("https://example.com");
  });
});

/* ------------------------------------------------------------------ */
/*  livePageUrl 전이는 스냅샷 저장을 예약하지 않는다                     */
/* ------------------------------------------------------------------ */

// `isLivePageUrlOnlyChange`의 순수 케이스는 계약만 고정한다 — 그 함수가 **존재하는 이유**
// (네비게이션마다 수 MB data URL 스냅샷 재직렬화)는 구독자를 실제로 돌려야 검증된다.
// early return을 지우면 여기가 red다.
describe("useEditorSessionSync — livePageUrl 저장 억제", () => {
  async function mountSynced() {
    const rendered = renderHook(() => useEditorSessionSync(7));
    await waitFor(() => expect(rendered.result.current).toBe(true));
    set.mockClear();
    return rendered;
  }

  async function settleDebounce() {
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("livePageUrl만 바뀌면 세션 저장을 예약하지 않는다", async () => {
    await mountSynced();

    act(() => {
      useEditorStore.getState().setLivePageUrl("https://example.com/invite/tok");
    });
    await settleDebounce();

    expect(set).not.toHaveBeenCalled();
  });

  // 억제가 과하면 진짜 편집이 유실된다 — 반대 방향을 함께 고정한다.
  it("영속 키가 바뀌면 저장한다", async () => {
    await mountSynced();

    act(() => {
      useEditorStore.setState({ phase: "drafting" });
    });
    await settleDebounce();

    expect(set).toHaveBeenCalled();
  });

  it("같은 전이에 영속 키가 함께 바뀌면 저장한다", async () => {
    await mountSynced();

    act(() => {
      useEditorStore.setState({
        livePageUrl: "https://example.com/invite/tok",
        phase: "drafting",
      });
    });
    await settleDebounce();

    expect(set).toHaveBeenCalled();
  });
});
