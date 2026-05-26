import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const {
  mockSaveDraft,
  mockPatchDraftSnapshot,
  mockPatchIssue,
  mockSaveImageBlob,
  mockSaveNetworkLog,
  mockSaveConsoleLog,
  mockDeleteNetworkLog,
  mockDeleteConsoleLog,
} = vi.hoisted(() => ({
  mockSaveDraft: vi.fn(),
  mockPatchDraftSnapshot: vi.fn(),
  mockPatchIssue: vi.fn(),
  mockSaveImageBlob: vi.fn().mockResolvedValue(true),
  mockSaveNetworkLog: vi.fn().mockResolvedValue(true),
  mockSaveConsoleLog: vi.fn().mockResolvedValue(true),
  mockDeleteNetworkLog: vi.fn().mockResolvedValue(undefined),
  mockDeleteConsoleLog: vi.fn().mockResolvedValue(undefined),
}));

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
  saveImageBlob: mockSaveImageBlob,
  saveNetworkLog: mockSaveNetworkLog,
  saveConsoleLog: mockSaveConsoleLog,
  deleteNetworkLog: mockDeleteNetworkLog,
  deleteConsoleLog: mockDeleteConsoleLog,
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
    useEditorStore.setState(useEditorStore.getInitialState(), true);
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

describe("onRecordingComplete — idle 직접 호출 (30s Replay)", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("idle에서 호출해도 captureMode=video, phase=drafting, video 필드를 설정한다", () => {
    const blob = new Blob(["x"], { type: "video/mp4" });
    const viewport = { width: 1280, height: 720 };

    useEditorStore.getState().onRecordingComplete(blob, "thumb", viewport);

    const s = useEditorStore.getState();
    expect(s.captureMode).toBe("video");
    expect(s.phase).toBe("drafting");
    expect(s.videoBlob).toBe(blob);
    expect(s.videoThumbnail).toBe("thumb");
    expect(s.videoViewport).toEqual(viewport);
    expect(s.videoCapturedAt).toBeGreaterThan(0);
  });
});

describe("confirmDraft video — 30s Replay target 가드", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    mockSaveDraft.mockClear();
  });

  // use30sReplay.capture()가 하는 것: target 설정 + onRecordingComplete + draft
  it("target 설정 시 video 브랜치로 saveDraft를 호출한다", () => {
    useEditorStore.setState({ target });
    useEditorStore
      .getState()
      .onRecordingComplete(new Blob(["v"], { type: "video/mp4" }), "thumb", {
        width: 1280,
        height: 720,
      });
    useEditorStore.setState({ draft: { title: "Replay bug", sections: {} } });

    useEditorStore.getState().confirmDraft();

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.captureMode).toBe("video");
    expect(record.pageUrl).toBe(target.url);
  });

  it("target 미설정이면 저장 없이 previewing으로 빠진다 (회귀 가드)", () => {
    useEditorStore
      .getState()
      .onRecordingComplete(new Blob(["v"], { type: "video/mp4" }), "thumb", {
        width: 1280,
        height: 720,
      });
    useEditorStore.setState({ draft: { title: "Replay bug", sections: {} } });

    useEditorStore.getState().confirmDraft();

    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(useEditorStore.getState().phase).toBe("previewing");
  });
});

/* ------------------------------------------------------------------ */
/*  confirmDraft screenshot — 로그 blobKey 연결                          */
/* ------------------------------------------------------------------ */

describe("confirmDraft screenshot — 로그 blobKey 연결", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
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

/* ------------------------------------------------------------------ */
/*  confirmDraft screenshot — IIFE 사이드 이펙트 (실제 영속 호출)         */
/* ------------------------------------------------------------------ */

describe("confirmDraft screenshot — IIFE 사이드 이펙트", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    mockSaveDraft.mockClear();
    mockSaveImageBlob.mockClear();
    mockSaveNetworkLog.mockClear();
    mockSaveConsoleLog.mockClear();
    mockDeleteNetworkLog.mockClear();
    mockDeleteConsoleLog.mockClear();
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

  it("networkLogAttach=true → saveNetworkLog(issueId, log) + deleteNetworkLog(pending:tabId) 호출", async () => {
    setupScreenshotDrafting({
      networkLog: fakeNetworkLog,
      networkLogAttach: true,
    });

    useEditorStore.getState().confirmDraft();
    await vi.waitFor(() => {
      expect(mockSaveNetworkLog).toHaveBeenCalled();
    });

    const issueId = mockSaveDraft.mock.calls[0][0].id;
    expect(mockSaveNetworkLog).toHaveBeenCalledWith(issueId, fakeNetworkLog);
    expect(mockDeleteNetworkLog).toHaveBeenCalledWith(`pending:${target.tabId}`);
  });

  it("consoleLogAttach=true → saveConsoleLog(issueId, log) + deleteConsoleLog(pending:tabId) 호출", async () => {
    setupScreenshotDrafting({
      consoleLog: fakeConsoleLog,
      consoleLogAttach: true,
    });

    useEditorStore.getState().confirmDraft();
    await vi.waitFor(() => {
      expect(mockSaveConsoleLog).toHaveBeenCalled();
    });

    const issueId = mockSaveDraft.mock.calls[0][0].id;
    expect(mockSaveConsoleLog).toHaveBeenCalledWith(issueId, fakeConsoleLog);
    expect(mockDeleteConsoleLog).toHaveBeenCalledWith(`pending:${target.tabId}`);
  });

  it("networkLogAttach=false → saveNetworkLog 미호출", async () => {
    setupScreenshotDrafting({
      networkLog: fakeNetworkLog,
      networkLogAttach: false,
    });

    useEditorStore.getState().confirmDraft();
    await vi.waitFor(() => {
      expect(mockSaveImageBlob).toHaveBeenCalled();
    });

    expect(mockSaveNetworkLog).not.toHaveBeenCalled();
    expect(mockDeleteNetworkLog).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  인라인 캡처 상태 관리                                                  */
/* ------------------------------------------------------------------ */

describe("startInlineCapture", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("sectionId를 설정한다", () => {
    useEditorStore.getState().startInlineCapture("description");

    expect(useEditorStore.getState().inlineCaptureTarget).toBe("description");
  });

  it("phase는 변경하지 않는다", () => {
    useEditorStore.setState({ phase: "drafting" });

    useEditorStore.getState().startInlineCapture("description");

    expect(useEditorStore.getState().phase).toBe("drafting");
  });
});

describe("cancelInlineCapture", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("inlineCaptureTarget을 null로 초기화한다", () => {
    useEditorStore.setState({ inlineCaptureTarget: "description" } as never);

    useEditorStore.getState().cancelInlineCapture();

    expect(useEditorStore.getState().inlineCaptureTarget).toBeNull();
  });
});

describe("appendInlineImage", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("빈 섹션에 이미지 ref를 추가한다", () => {
    useEditorStore.setState({
      draft: { title: "Bug", sections: { description: "" } },
    });

    useEditorStore.getState().appendInlineImage("description", "ref-1");

    expect(useEditorStore.getState().draft!.sections.description).toBe(
      "![](inline:ref-1)",
    );
  });

  it("기존 텍스트 있는 섹션에 \\n\\n으로 구분하여 추가한다", () => {
    useEditorStore.setState({
      draft: { title: "Bug", sections: { description: "Some text here" } },
    });

    useEditorStore.getState().appendInlineImage("description", "ref-1");

    expect(useEditorStore.getState().draft!.sections.description).toBe(
      "Some text here\n\n![](inline:ref-1)",
    );
  });

  it("줄바꿈으로 끝나는 섹션에서도 \\n\\n으로 구분한다", () => {
    useEditorStore.setState({
      draft: { title: "Bug", sections: { description: "Line one\n" } },
    });

    useEditorStore.getState().appendInlineImage("description", "ref-1");

    expect(useEditorStore.getState().draft!.sections.description).toBe(
      "Line one\n\n\n![](inline:ref-1)",
    );
  });

  it("draft === null이면 상태 변경 없음", () => {
    useEditorStore.setState({ draft: null });

    useEditorStore.getState().appendInlineImage("description", "ref-1");

    expect(useEditorStore.getState().draft).toBeNull();
  });

  it("연속 호출 시 각 이미지가 \\n\\n으로 구분된다", () => {
    useEditorStore.setState({
      draft: { title: "Bug", sections: { description: "" } },
    });

    useEditorStore.getState().appendInlineImage("description", "ref-1");
    useEditorStore.getState().appendInlineImage("description", "ref-2");

    expect(useEditorStore.getState().draft!.sections.description).toBe(
      "![](inline:ref-1)\n\n![](inline:ref-2)",
    );
  });
});

describe("reset — inlineCaptureTarget 초기화", () => {
  it("reset() 후 inlineCaptureTarget === null", () => {
    useEditorStore.setState({ inlineCaptureTarget: "description" } as never);

    useEditorStore.getState().reset();

    expect(useEditorStore.getState().inlineCaptureTarget).toBeNull();
  });
});
