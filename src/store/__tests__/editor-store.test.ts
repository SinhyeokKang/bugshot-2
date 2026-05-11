import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockSaveDraft = vi.fn();
const mockPatchDraftSnapshot = vi.fn();
const mockPatchIssue = vi.fn();

vi.mock("@/store/issues-store", () => ({
  useIssuesStore: {
    getState: () => ({
      saveDraft: mockSaveDraft,
      patchDraftSnapshot: mockPatchDraftSnapshot,
      patchIssue: mockPatchIssue,
    }),
  },
}));

vi.mock("@/store/settings-store", () => ({
  useSettingsStore: {
    getState: () => ({
      lastSubmitFields: {},
      accounts: {},
    }),
  },
}));

vi.mock("@/store/blob-db", () => ({
  saveVideoBlob: vi.fn().mockResolvedValue(true),
  saveImageBlob: vi.fn().mockResolvedValue(true),
  saveNetworkLog: vi.fn().mockResolvedValue(true),
  saveConsoleLog: vi.fn().mockResolvedValue(true),
  deleteNetworkLog: vi.fn().mockResolvedValue(undefined),
  deleteConsoleLog: vi.fn().mockResolvedValue(undefined),
  dataUrlToBlob: vi.fn((url: string) => new Blob([url])),
  getNetworkLog: vi.fn().mockResolvedValue(null),
  getConsoleLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/types/messages", () => ({
  onBlobSaveFailed: { fire: vi.fn(), listen: vi.fn() },
}));

import { useEditorStore } from "../editor-store";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const target = { tabId: 1, url: "https://example.com", title: "Test" };

const fakeNetworkLog: NetworkLog = {
  id: "net-1",
  startedAt: 1000,
  endedAt: 2000,
  totalSeen: 5,
  captured: 3,
  warnings: [],
  requests: [],
};

const fakeConsoleLog: ConsoleLog = {
  id: "con-1",
  startedAt: 1000,
  endedAt: 2000,
  totalSeen: 10,
  captured: 8,
  entries: [],
};

/* ------------------------------------------------------------------ */
/*  startCapturing — 백그라운드 로그 보존                                 */
/* ------------------------------------------------------------------ */

describe("startCapturing — 백그라운드 로그 보존", () => {
  beforeEach(() => {
    useEditorStore.setState({ ...useEditorStore.getInitialState() });
  });

  it("기존 networkLog를 보존한다", () => {
    useEditorStore.setState({ networkLog: fakeNetworkLog });

    useEditorStore.getState().startCapturing(target);

    expect(useEditorStore.getState().networkLog).toEqual(fakeNetworkLog);
  });

  it("기존 consoleLog를 보존한다", () => {
    useEditorStore.setState({ consoleLog: fakeConsoleLog });

    useEditorStore.getState().startCapturing(target);

    expect(useEditorStore.getState().consoleLog).toEqual(fakeConsoleLog);
  });

  it("networkLogAttach는 false로 리셋한다", () => {
    useEditorStore.setState({ networkLogAttach: true });

    useEditorStore.getState().startCapturing(target);

    expect(useEditorStore.getState().networkLogAttach).toBe(false);
  });

  it("consoleLogAttach는 false로 리셋한다", () => {
    useEditorStore.setState({ consoleLogAttach: true });

    useEditorStore.getState().startCapturing(target);

    expect(useEditorStore.getState().consoleLogAttach).toBe(false);
  });

  it("phase=capturing, captureMode=screenshot으로 전환한다", () => {
    useEditorStore.getState().startCapturing(target);

    const s = useEditorStore.getState();
    expect(s.phase).toBe("capturing");
    expect(s.captureMode).toBe("screenshot");
  });
});

/* ------------------------------------------------------------------ */
/*  confirmDraft screenshot — 로그 blobKey 연결                          */
/* ------------------------------------------------------------------ */

describe("confirmDraft screenshot — 로그 blobKey 연결", () => {
  beforeEach(() => {
    useEditorStore.setState({ ...useEditorStore.getInitialState() });
    mockSaveDraft.mockClear();
  });

  function setupScreenshotDrafting(overrides: Record<string, unknown> = {}) {
    useEditorStore.setState({
      captureMode: "screenshot" as const,
      phase: "drafting" as const,
      targetPlatform: "github" as const,
      target,
      screenshotRaw: "data:image/png;base64,abc",
      screenshotViewport: { width: 800, height: 600 },
      draft: { title: "Bug title", sections: {} },
      ...overrides,
    });
  }

  it("networkLogAttach=true + captured>0 → networkLogBlobKey를 설정한다", () => {
    setupScreenshotDrafting({
      networkLog: fakeNetworkLog,
      networkLogAttach: true,
    });

    useEditorStore.getState().confirmDraft();

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.networkLogBlobKey).toBeDefined();
    expect(record.networkLogBlobKey).toBe(record.id);
  });

  it("consoleLogAttach=true + captured>0 → consoleLogBlobKey를 설정한다", () => {
    setupScreenshotDrafting({
      consoleLog: fakeConsoleLog,
      consoleLogAttach: true,
    });

    useEditorStore.getState().confirmDraft();

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.consoleLogBlobKey).toBeDefined();
    expect(record.consoleLogBlobKey).toBe(record.id);
  });

  it("networkLogAttach=false → networkLogBlobKey가 undefined", () => {
    setupScreenshotDrafting({
      networkLog: fakeNetworkLog,
      networkLogAttach: false,
    });

    useEditorStore.getState().confirmDraft();

    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.networkLogBlobKey).toBeUndefined();
  });

  it("networkLog가 null → networkLogBlobKey가 undefined", () => {
    setupScreenshotDrafting({
      networkLog: null,
      networkLogAttach: true,
    });

    useEditorStore.getState().confirmDraft();

    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.networkLogBlobKey).toBeUndefined();
  });

  it("captured=0 → networkLogBlobKey가 undefined", () => {
    setupScreenshotDrafting({
      networkLog: { ...fakeNetworkLog, captured: 0 },
      networkLogAttach: true,
    });

    useEditorStore.getState().confirmDraft();

    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.networkLogBlobKey).toBeUndefined();
  });
});
