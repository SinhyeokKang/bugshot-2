import { describe, it, expect, vi, beforeEach } from "vitest";

// 훅 모듈은 React·picker·IDB에 닿지만, 여기서 검증하는 건 순수 직렬화(snapshotFromState)뿐이다.
vi.mock("@/sidepanel/picker-control", () => ({
  cancelAreaSelect: vi.fn(),
  clearPicker: vi.fn(),
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

import {
  EDITOR_SNAPSHOT_KEYS,
  type EditorSnapshot,
  useEditorStore,
} from "@/store/editor-store";
import {
  isLivePageUrlOnlyChange,
  migrateLegacyDraft,
  snapshotFromState,
} from "../useEditorSessionSync";

describe("snapshotFromState — 세션 직렬화 키 그물", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  // EditorSnapshot에 필드를 더하고 snapshotFromState에 안 넣으면 타입도 런타임도 안 깨지고
  // 값만 조용히 초기값이 된다(ARCHITECTURE.md의 명시된 함정). 이 기능과 무관하게 앞으로도 지킨다.
  it("결과 키 집합이 EditorSnapshot 키 목록과 정확히 일치한다", () => {
    expect(Object.keys(snapshotFromState()).sort()).toEqual(
      [...EDITOR_SNAPSHOT_KEYS].sort(),
    );
  });

  it("top-level annotated 두 필드를 값까지 보존한다", () => {
    useEditorStore.setState({
      beforeAnnotated: "data:before-ann",
      afterAnnotated: "data:after-ann",
    });

    const snap = snapshotFromState();

    expect(snap.beforeAnnotated).toBe("data:before-ann");
    expect(snap.afterAnnotated).toBe("data:after-ann");
  });

  it("annotated 두 필드가 EditorSnapshot 키 목록에 들어 있다", () => {
    expect(EDITOR_SNAPSHOT_KEYS).toContain("beforeAnnotated");
    expect(EDITOR_SNAPSHOT_KEYS).toContain("afterAnnotated");
  });
});

describe("migrateLegacyDraft — 주석 필드 역방향 호환", () => {
  it("구버전 스냅샷에 없는 annotated 필드를 null로 보충한다", () => {
    const legacy = snapshotFromState() as Partial<EditorSnapshot> & Record<string, unknown>;
    delete legacy.beforeAnnotated;
    delete legacy.afterAnnotated;

    const migrated = migrateLegacyDraft(legacy as EditorSnapshot);

    expect(migrated.beforeAnnotated).toBeNull();
    expect(migrated.afterAnnotated).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  isLivePageUrlOnlyChange — 네비게이션마다 스냅샷 저장 예약 방지        */
/* ------------------------------------------------------------------ */

// livePageUrl은 비영속이라 그 전이만으로는 저장할 게 없다. 걸러내지 않으면 탭 이동마다
// screenshot/video drafting 스냅샷(수 MB data URL)이 통째로 재직렬화된다.
describe("isLivePageUrlOnlyChange", () => {
  const base = () => useEditorStore.getInitialState();

  it("livePageUrl만 달라지면 true", () => {
    const prev = { ...base(), livePageUrl: "https://a.com" };
    const next = { ...prev, livePageUrl: "https://b.com" };
    expect(isLivePageUrlOnlyChange(prev, next)).toBe(true);
  });

  it("livePageUrl이 그대로면 false", () => {
    const prev = { ...base(), livePageUrl: "https://a.com" };
    expect(isLivePageUrlOnlyChange(prev, { ...prev })).toBe(false);
  });

  // 같은 전이에 영속 키가 함께 바뀌었으면 저장해야 한다 — 여기서 true를 내면
  // 그 변경이 세션에서 통째로 유실된다.
  it("영속 키가 함께 바뀌면 false", () => {
    const prev = { ...base(), livePageUrl: "https://a.com" };
    const next = { ...prev, livePageUrl: "https://b.com", phase: "drafting" as const };
    expect(isLivePageUrlOnlyChange(prev, next)).toBe(false);
  });

  it("영속 키가 참조로 교체돼도 잡는다 (draft 객체)", () => {
    const prev = { ...base(), livePageUrl: "https://a.com", draft: { title: "T", sections: {} } };
    const next = {
      ...prev,
      livePageUrl: "https://b.com",
      draft: { title: "T", sections: {} },
    };
    expect(isLivePageUrlOnlyChange(prev, next)).toBe(false);
  });
});
