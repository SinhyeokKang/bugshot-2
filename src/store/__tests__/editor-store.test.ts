import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  mockClearNetworkRecorder,
  mockClearConsoleRecorder,
} = vi.hoisted(() => ({
  mockSaveDraft: vi.fn(),
  mockPatchDraftSnapshot: vi.fn(),
  mockPatchIssue: vi.fn(),
  mockSaveImageBlob: vi.fn().mockResolvedValue(true),
  mockSaveNetworkLog: vi.fn().mockResolvedValue(true),
  mockSaveConsoleLog: vi.fn().mockResolvedValue(true),
  mockDeleteNetworkLog: vi.fn().mockResolvedValue(undefined),
  mockDeleteConsoleLog: vi.fn().mockResolvedValue(undefined),
  mockClearNetworkRecorder: vi.fn().mockResolvedValue(undefined),
  mockClearConsoleRecorder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/sidepanel/recorder-control", () => ({
  clearNetworkRecorder: mockClearNetworkRecorder,
  clearConsoleRecorder: mockClearConsoleRecorder,
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

// Jira prefill 테스트가 lastSubmitFields/accounts를 갈아끼울 수 있게 가변으로 둔다(기본값은 빈 객체 — 기존 동작 불변).
const settingsState = vi.hoisted(() => ({
  current: {} as { lastSubmitFields: Record<string, unknown>; accounts: Record<string, unknown> },
}));
settingsState.current = { lastSubmitFields: {}, accounts: {} };

vi.mock("@/store/settings-store", () => ({
  useSettingsStore: {
    getState: () => settingsState.current,
  },
}));

vi.mock("@/store/blob-db", () => ({
  saveVideoBlob: vi.fn().mockResolvedValue(true),
  deleteVideoBlob: vi.fn().mockResolvedValue(undefined),
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

import { useEditorStore, mergeSelectionStyles } from "../editor-store";

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

  it("networkLogAttach를 자동으로 켠다 (직전 off여도 on)", () => {
    useEditorStore.setState({ networkLogAttach: false });

    useEditorStore.getState().startCapturing(target);

    expect(useEditorStore.getState().networkLogAttach).toBe(true);
  });

  it("consoleLogAttach를 자동으로 켠다 (직전 off여도 on)", () => {
    useEditorStore.setState({ consoleLogAttach: false });

    useEditorStore.getState().startCapturing(target);

    expect(useEditorStore.getState().consoleLogAttach).toBe(true);
  });

  it("phase=capturing, captureMode=screenshot으로 전환한다", () => {
    useEditorStore.getState().startCapturing(target);

    const s = useEditorStore.getState();
    expect(s.phase).toBe("capturing");
    expect(s.captureMode).toBe("screenshot");
  });
});

describe("onAreaCaptured — screenshot 첨부 토글 기본 on", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("신규 진입 시 attach 토글을 모두 켠다", () => {
    useEditorStore.getState().startCapturing(target);
    useEditorStore.getState().onAreaCaptured("data:,", { width: 800, height: 600 });

    const s = useEditorStore.getState();
    expect(s.phase).toBe("drafting");
    expect(s.networkLogAttach).toBe(true);
    expect(s.consoleLogAttach).toBe(true);
    expect(s.actionLogAttach).toBe(true);
  });
});

// 트림 오버레이 페이로드 — 게이트와 한 몸이라 onRecordingComplete 인자로 실린다.
function replayTrim() {
  return {
    videoBlob: new Blob(["v"], { type: "video/mp4" }),
    frames: [
      { blob: new Blob(["f0"]), timestamp: 0 },
      { blob: new Blob(["f1"]), timestamp: 100 },
    ],
  };
}

describe("onRecordingComplete — idle 직접 호출 (30s Replay)", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("idle에서 호출해도 captureMode=video, phase=drafting, video 필드를 설정한다", () => {
    const blob = new Blob(["x"], { type: "video/mp4" });
    const viewport = { width: 1280, height: 720 };

    useEditorStore.getState().onRecordingComplete(blob, "thumb", viewport, 1000, 5000);

    const s = useEditorStore.getState();
    expect(s.captureMode).toBe("video");
    expect(s.phase).toBe("drafting");
    expect(s.videoBlob).toBe(blob);
    expect(s.videoThumbnail).toBe("thumb");
    expect(s.videoViewport).toEqual(viewport);
    expect(s.videoCapturedAt).toBeGreaterThan(0);
    expect(s.videoStartedAt).toBe(1000);
    expect(s.videoEndedAt).toBe(5000);
  });

  it("펜 ON 상태로 녹화가 끝나도 annotationTool을 null로 리셋한다", () => {
    useEditorStore.getState().setAnnotationTool("pen");
    expect(useEditorStore.getState().annotationTool).toBe("pen");

    useEditorStore.getState().onRecordingComplete(new Blob(["x"]), "t", { width: 800, height: 600 }, 1000, 5000);

    expect(useEditorStore.getState().annotationTool).toBe(null);
  });

  // 리플레이는 startRecording을 안 거쳐 drafting에 직행하므로, 그 리셋에 기댈 수 없다.
  it("리플레이 경로에서도 reproPrefillDone을 리셋한다(직전 세션 래치 상속 차단)", () => {
    useEditorStore.getState().setReproPrefillDone(true);

    useEditorStore.getState().onRecordingComplete(new Blob(["x"]), "t", { width: 800, height: 600 }, 1000, 5000);

    expect(useEditorStore.getState().reproPrefillDone).toBe(false);
  });

  it("trim 인자 생략(탭/화면 녹화)이면 replayTrim은 null이다", () => {
    useEditorStore.getState().onRecordingComplete(new Blob(["x"]), "t", { width: 800, height: 600 }, 1000, 5000);

    expect(useEditorStore.getState().replayTrim).toBe(null);
  });

  // 회귀 가드의 핵심 계약. drafting 전이(zustand)와 trim 게이트(과거 React state)가 다른 레인으로
  // 갈리면 trim 게이트가 닫히기 전 렌더가 한 번 새고, 그 틈에 DraftingPanel이 마운트돼
  // useReproPrefill이 발화→언마운트 취소→결과 폐기+done 래치로 영구 미발화가 된다.
  // 게이트가 같은 set()에 실려야 구독자가 그 중간 상태를 볼 수 없다.
  it("phase=drafting을 보는 첫 알림에서 replayTrim이 이미 실려 있다(전이 원자성)", () => {
    const seen: Array<{ phase: string; hasTrim: boolean }> = [];
    const unsub = useEditorStore.subscribe((s) => {
      seen.push({ phase: s.phase, hasTrim: s.replayTrim != null });
    });

    useEditorStore
      .getState()
      .onRecordingComplete(new Blob(["x"]), "t", { width: 800, height: 600 }, 1000, 5000, replayTrim());
    unsub();

    const firstDrafting = seen.find((s) => s.phase === "drafting");
    expect(firstDrafting).toBeDefined();
    expect(firstDrafting?.hasTrim).toBe(true);
  });

  // 페이로드가 게이트와 한 몸이라 얻는 것. 로컬 state로 두면 store만 리셋되고 페이로드가 살아남아
  // "reset 호출부를 전수해서 얻은 안전"에 의존해야 한다.
  it("reset이 replayTrim까지 청소한다", () => {
    useEditorStore
      .getState()
      .onRecordingComplete(new Blob(["x"]), "t", { width: 800, height: 600 }, 1000, 5000, replayTrim());
    expect(useEditorStore.getState().replayTrim).not.toBe(null);

    useEditorStore.getState().reset();

    expect(useEditorStore.getState().replayTrim).toBe(null);
  });

  it("resolveReplayTrim이 게이트를 내린다", () => {
    useEditorStore
      .getState()
      .onRecordingComplete(new Blob(["x"]), "t", { width: 800, height: 600 }, 1000, 5000, replayTrim());
    expect(useEditorStore.getState().replayTrim).not.toBe(null);

    useEditorStore.getState().resolveReplayTrim();

    expect(useEditorStore.getState().replayTrim).toBe(null);
  });
});

describe("replaceVideo — trim 확정 영상 메타 교체", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("영상 메타(blob/thumbnail/startedAt/endedAt)만 바뀌고 phase·attach 토글은 불변", () => {
    const orig = new Blob(["x"], { type: "video/mp4" });
    useEditorStore.getState().onRecordingComplete(orig, "t0", { width: 800, height: 600 }, 1000, 5000);
    useEditorStore.setState({ networkLogAttach: false });

    const next = new Blob(["y"], { type: "video/mp4" });
    useEditorStore.getState().replaceVideo(next, "t1", 2000, 4000);

    const s = useEditorStore.getState();
    expect(s.videoBlob).toBe(next);
    expect(s.videoThumbnail).toBe("t1");
    expect(s.videoStartedAt).toBe(2000);
    expect(s.videoEndedAt).toBe(4000);
    expect(s.phase).toBe("drafting");
    expect(s.networkLogAttach).toBe(false);
    expect(s.consoleLogAttach).toBe(true);
    expect(s.actionLogAttach).toBe(true);
  });

  it("videoCapturedAt은 호출 전 값 그대로(원본 캡처 시각 보존)", () => {
    const orig = new Blob(["x"], { type: "video/mp4" });
    useEditorStore.getState().onRecordingComplete(orig, "t0", { width: 800, height: 600 }, 1000, 5000);
    const capturedAt = useEditorStore.getState().videoCapturedAt;

    useEditorStore.getState().replaceVideo(new Blob(["y"]), "t1", 2000, 4000);

    expect(useEditorStore.getState().videoCapturedAt).toBe(capturedAt);
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
      }, 1000, 5000);
    useEditorStore.setState({ draft: { title: "Replay bug", sections: {} } });

    useEditorStore.getState().confirmDraft();

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.captureMode).toBe("video");
    expect(record.pageUrl).toBe(target.url);
    expect(record.videoStartedAt).toBe(1000);
    expect(record.videoEndedAt).toBe(5000);
  });

  it("target 미설정이면 저장 없이 previewing으로 빠진다 (회귀 가드)", () => {
    useEditorStore
      .getState()
      .onRecordingComplete(new Blob(["v"], { type: "video/mp4" }), "thumb", {
        width: 1280,
        height: 720,
      }, 1000, 5000);
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

  it("정상 저장 경로 → true 반환(성공 토스트 게이트)", () => {
    setupScreenshotDrafting();
    expect(useEditorStore.getState().confirmDraft()).toBe(true);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("draft 미설정 → 미저장이라 false 반환", () => {
    // beforeEach가 initial로 리셋 → draft/target null이라 early return.
    expect(useEditorStore.getState().confirmDraft()).toBe(false);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

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

  // element-screenshot: 요소 캡처(shotSelector)는 IssueRecord에 selector/tagName 저장.
  it("shotSelector 존재(요소 캡처) → selector/tagName을 저장한다", () => {
    setupScreenshotDrafting({
      shotSelector: { selector: "button.cta", tagName: "button" },
    });

    useEditorStore.getState().confirmDraft();

    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.selector).toBe("button.cta");
    expect(record.tagName).toBe("button");
  });

  it("shotSelector null(범위 캡처) → selector/tagName 미저장 (회귀)", () => {
    setupScreenshotDrafting({ shotSelector: null });

    useEditorStore.getState().confirmDraft();

    const record = mockSaveDraft.mock.calls[0][0];
    expect(record.selector).toBeUndefined();
    expect(record.tagName).toBeUndefined();
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

/* ------------------------------------------------------------------ */
/*  startPicking / startFreeform — cross-page 로그 보존                  */
/* ------------------------------------------------------------------ */

describe("startPicking — 로그·토글 보존", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("networkLog/consoleLog와 attach 토글을 보존한다", () => {
    useEditorStore.setState({
      networkLog: fakeNetworkLog,
      consoleLog: fakeConsoleLog,
      networkLogAttach: true,
      consoleLogAttach: true,
    });

    useEditorStore.getState().startPicking(target);

    const s = useEditorStore.getState();
    expect(s.networkLog).toEqual(fakeNetworkLog);
    expect(s.consoleLog).toEqual(fakeConsoleLog);
    expect(s.networkLogAttach).toBe(true);
    expect(s.consoleLogAttach).toBe(true);
  });

  it("phase=picking, captureMode=element로 전환하고 selection은 리셋한다", () => {
    useEditorStore.setState({ selection: { selector: ".x" } as never });

    useEditorStore.getState().startPicking(target);

    const s = useEditorStore.getState();
    expect(s.phase).toBe("picking");
    expect(s.captureMode).toBe("element");
    expect(s.selection).toBeNull();
  });
});

describe("startFreeform — 로그·토글 보존", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("networkLog/consoleLog와 attach 토글을 보존한다", () => {
    useEditorStore.setState({
      networkLog: fakeNetworkLog,
      consoleLog: fakeConsoleLog,
      networkLogAttach: true,
      consoleLogAttach: true,
    });

    useEditorStore.getState().startFreeform(target);

    const s = useEditorStore.getState();
    expect(s.networkLog).toEqual(fakeNetworkLog);
    expect(s.consoleLog).toEqual(fakeConsoleLog);
    expect(s.networkLogAttach).toBe(true);
    expect(s.consoleLogAttach).toBe(true);
  });

  it("phase=drafting, captureMode=freeform으로 전환한다", () => {
    useEditorStore.getState().startFreeform(target);

    const s = useEditorStore.getState();
    expect(s.phase).toBe("drafting");
    expect(s.captureMode).toBe("freeform");
  });
});

/* ------------------------------------------------------------------ */
/*  clearNetworkLog / clearConsoleLog                                  */
/* ------------------------------------------------------------------ */

describe("clearNetworkLog / clearConsoleLog", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    mockDeleteNetworkLog.mockClear();
    mockDeleteConsoleLog.mockClear();
    mockClearNetworkRecorder.mockClear();
    mockClearConsoleRecorder.mockClear();
  });

  it("clearNetworkLog(tabId): store null + pending 삭제 + MAIN buffer clear", () => {
    useEditorStore.setState({ networkLog: fakeNetworkLog });

    useEditorStore.getState().clearNetworkLog(1);

    expect(useEditorStore.getState().networkLog).toBeNull();
    expect(mockDeleteNetworkLog).toHaveBeenCalledWith("pending:1");
    expect(mockClearNetworkRecorder).toHaveBeenCalledWith(1);
  });

  it("clearNetworkLog(null): store만 null, pending/MAIN clear는 스킵", () => {
    useEditorStore.setState({ networkLog: fakeNetworkLog });

    useEditorStore.getState().clearNetworkLog(null);

    expect(useEditorStore.getState().networkLog).toBeNull();
    expect(mockDeleteNetworkLog).not.toHaveBeenCalled();
    expect(mockClearNetworkRecorder).not.toHaveBeenCalled();
  });

  it("clearConsoleLog(tabId): store null + pending 삭제 + MAIN buffer clear", () => {
    useEditorStore.setState({ consoleLog: fakeConsoleLog });

    useEditorStore.getState().clearConsoleLog(2);

    expect(useEditorStore.getState().consoleLog).toBeNull();
    expect(mockDeleteConsoleLog).toHaveBeenCalledWith("pending:2");
    expect(mockClearConsoleRecorder).toHaveBeenCalledWith(2);
  });

  it("clearConsoleLog(null): store만 null, pending/MAIN clear는 스킵", () => {
    useEditorStore.setState({ consoleLog: fakeConsoleLog });

    useEditorStore.getState().clearConsoleLog(null);

    expect(useEditorStore.getState().consoleLog).toBeNull();
    expect(mockDeleteConsoleLog).not.toHaveBeenCalled();
    expect(mockClearConsoleRecorder).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  element-screenshot — 요소 캡처 진입/선택 액션                          */
/* ------------------------------------------------------------------ */

describe("startElementShot — 요소 캡처 진입", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("captureMode='screenshot' + phase='picking' + shotSelector=null", () => {
    useEditorStore.getState().startElementShot(target);

    const s = useEditorStore.getState();
    expect(s.captureMode).toBe("screenshot");
    expect(s.phase).toBe("picking");
    expect(s.shotSelector).toBeNull();
  });

  it("attach 토글을 모두 켠다 (직전 off여도 on)", () => {
    useEditorStore.setState({ networkLogAttach: false, consoleLogAttach: false });
    useEditorStore.getState().startElementShot(target);

    const s = useEditorStore.getState();
    expect(s.networkLogAttach).toBe(true);
    expect(s.consoleLogAttach).toBe(true);
    expect(s.actionLogAttach).toBe(true);
  });
});

describe("onElementShot — 요소 선택 → drafting", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("screenshotRaw·viewport·shotSelector 세팅 + phase='drafting' + selection은 null 유지", () => {
    useEditorStore.getState().startElementShot(target);
    useEditorStore
      .getState()
      .onElementShot(
        { selector: "button.cta", tagName: "button" },
        "data:image/png;base64,X",
        { width: 800, height: 600 },
      );

    const s = useEditorStore.getState();
    expect(s.screenshotRaw).toBe("data:image/png;base64,X");
    expect(s.screenshotViewport).toEqual({ width: 800, height: 600 });
    expect(s.shotSelector).toEqual({ selector: "button.cta", tagName: "button" });
    expect(s.phase).toBe("drafting");
    expect(s.selection).toBeNull();
  });
});

describe("bufferCurrentElement — 복수 element 버퍼", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  function setCurrent(opts: {
    selector: string;
    inline?: Record<string, string>;
    before?: string | null;
  }) {
    useEditorStore.setState({
      selection: {
        selector: opts.selector,
        tagName: "button",
        classList: ["cta"],
        computedStyles: { color: "#000000" },
        specifiedStyles: {},
        propSources: {},
        hasParent: true,
        hasChild: false,
        text: null,
        viewport: { width: 1440, height: 900 },
        capturedAt: 1700000000000,
      },
      styleEdits: {
        classList: ["cta"],
        inlineStyle: opts.inline ?? { color: "#ffffff" },
        text: "",
      },
      beforeImage: opts.before ?? "data:before-1",
    });
  }

  it("현재 element를 버퍼에 append", () => {
    setCurrent({ selector: "button.cta", before: "data:before-A" });
    useEditorStore.getState().bufferCurrentElement("data:after-A");

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf).toHaveLength(1);
    expect(buf[0]).toEqual({
      selector: "button.cta",
      tagName: "button",
      frameId: 0,
      origin: "",
      selectionSnapshot: {
        classList: ["cta"],
        specifiedStyles: {},
        computedStyles: { color: "#000000" },
        propSources: {},
        text: null,
        viewport: { width: 1440, height: 900 },
        capturedAt: 1700000000000,
      },
      styleEdits: { classList: ["cta"], inlineStyle: { color: "#ffffff" }, text: "" },
      beforeImage: "data:before-A",
      afterImage: "data:after-A",
    });
  });

  it("같은 selector 재호출 시 갱신·최초 before 유지·길이 1", () => {
    setCurrent({ selector: "button.cta", inline: { color: "#ffffff" }, before: "data:before-1" });
    useEditorStore.getState().bufferCurrentElement("data:after-1");
    // 같은 selector 재편집: before는 새로 캡처됐지만 버퍼는 최초 before를 유지해야.
    setCurrent({ selector: "button.cta", inline: { color: "#ff0000" }, before: "data:before-2" });
    useEditorStore.getState().bufferCurrentElement("data:after-2");

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf).toHaveLength(1);
    expect(buf[0].beforeImage).toBe("data:before-1");
    expect(buf[0].afterImage).toBe("data:after-2");
    expect(buf[0].styleEdits.inlineStyle).toEqual({ color: "#ff0000" });
  });

  it("resetAllStyleEdits — 현재 styleEdits 초기화 + 버퍼 비움", () => {
    setCurrent({ selector: "button.cta", inline: { color: "#ffffff" } });
    useEditorStore.getState().bufferCurrentElement("data:after-A");
    setCurrent({ selector: "div.box", inline: { margin: "8px" } });
    expect(useEditorStore.getState().bufferedElements).toHaveLength(1);

    useEditorStore.getState().resetAllStyleEdits();

    const s = useEditorStore.getState();
    expect(s.bufferedElements).toHaveLength(0);
    expect(s.styleEdits.inlineStyle).toEqual({});
    expect(s.styleEdits.classList).toEqual(["cta"]);
  });

  it("다른 selector면 별개 항목 누적", () => {
    setCurrent({ selector: "button.cta" });
    useEditorStore.getState().bufferCurrentElement("data:after-A");
    setCurrent({ selector: "div.card" });
    useEditorStore.getState().bufferCurrentElement("data:after-B");

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf.map((b) => b.selector)).toEqual(["button.cta", "div.card"]);
  });

  it("startPicking 후에도 버퍼 보존 (preserveBuffer)", () => {
    setCurrent({ selector: "button.cta" });
    useEditorStore.getState().bufferCurrentElement("data:after-A");
    useEditorStore
      .getState()
      .startPicking({ tabId: 1, url: "https://e.com", title: "T" });

    expect(useEditorStore.getState().bufferedElements).toHaveLength(1);
  });

  it("onSubmitted 후 버퍼 비움", () => {
    setCurrent({ selector: "button.cta" });
    useEditorStore.getState().bufferCurrentElement("data:after-A");
    useEditorStore
      .getState()
      .onSubmitted({ key: "K-1", url: "https://e.com/K-1", platform: "jira" });

    expect(useEditorStore.getState().bufferedElements).toEqual([]);
  });

  it("reset 후 버퍼 비움", () => {
    setCurrent({ selector: "button.cta" });
    useEditorStore.getState().bufferCurrentElement("data:after-A");
    useEditorStore.getState().reset();

    expect(useEditorStore.getState().bufferedElements).toEqual([]);
  });

  it("selection이 없으면 no-op (방어)", () => {
    useEditorStore.setState({ selection: null });
    useEditorStore.getState().bufferCurrentElement("data:after-A");

    expect(useEditorStore.getState().bufferedElements).toEqual([]);
  });
});

describe("onElementSelected — 버퍼된 요소 재선택 시 편집 복원", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  function freshPayload(selector: string, overrides?: Partial<{
    classList: string[];
    specifiedStyles: Record<string, string>;
    computedStyles: Record<string, string>;
    text: string | null;
  }>) {
    return {
      selector,
      tagName: "h1",
      classList: overrides?.classList ?? ["title"],
      computedStyles: overrides?.computedStyles ?? { color: "#000000" },
      specifiedStyles: overrides?.specifiedStyles ?? {},
      propSources: {},
      hasParent: true,
      hasChild: false,
      text: overrides?.text ?? null,
      viewport: { width: 1440, height: 900 },
      capturedAt: 1700000000000,
    };
  }

  it("신규 selector → inlineStyle을 {}로 리셋 (기존 동작)", () => {
    useEditorStore.getState().onElementSelected(freshPayload("#title"));
    const s = useEditorStore.getState();
    expect(s.styleEdits.inlineStyle).toEqual({});
    expect(s.styleEdits.classList).toEqual(["title"]);
    expect(s.beforeImage).toBeNull();
    expect(s.phase).toBe("styling");
  });

  it("버퍼된 selector 재선택 → 버퍼의 styleEdits·snapshot·before/after 복원 + 버퍼에서 제거", () => {
    // #title을 py 편집 후 버퍼에 적재
    useEditorStore.setState({
      selection: freshPayload("#title", { specifiedStyles: { "padding-top": "8px", "padding-bottom": "8px" } }),
      styleEdits: {
        classList: ["title"],
        inlineStyle: { "padding-top": "20px", "padding-bottom": "20px" },
        text: "",
      },
      beforeImage: "data:before-title",
    });
    useEditorStore.getState().bufferCurrentElement("data:after-title");
    expect(useEditorStore.getState().bufferedElements).toHaveLength(1);

    // 다른 요소로 전환했다가 #title을 재선택. 재선택 payload는 인라인이 새어든 폴루션 specified를 가질 수 있다.
    useEditorStore.getState().onElementSelected(
      freshPayload("#title", { specifiedStyles: { "padding-top": "20px", "padding-bottom": "20px" } }),
    );

    const s = useEditorStore.getState();
    // 작업 styleEdits가 버퍼 편집으로 복원됨
    expect(s.styleEdits.inlineStyle).toEqual({ "padding-top": "20px", "padding-bottom": "20px" });
    // baseline(diff 전값)은 버퍼 snapshot의 원본 specified를 사용
    expect(s.selection?.specifiedStyles).toEqual({ "padding-top": "8px", "padding-bottom": "8px" });
    // before/after 이미지 복원
    expect(s.beforeImage).toBe("data:before-title");
    expect(s.afterImage).toBe("data:after-title");
    // 중복 방지: 버퍼에서 제거 (현재 요소로 승격)
    expect(s.bufferedElements).toHaveLength(0);
    expect(s.phase).toBe("styling");
  });

  it("버퍼된 selector 재선택 → propSources도 snapshot에서 복원 ([inline] 오염 차단)", () => {
    useEditorStore.setState({
      selection: {
        ...freshPayload("#title", { specifiedStyles: { color: "rgb(50, 50, 50)" } }),
        propSources: { color: ".swatch" },
      },
      styleEdits: {
        classList: ["title"],
        inlineStyle: { color: "rgb(255, 0, 0)" },
        text: "",
      },
      beforeImage: null,
    });
    useEditorStore.getState().bufferCurrentElement(null);

    // 재선택 payload는 css-resolve가 el.style을 접어 [inline] 소스로 보고한다.
    useEditorStore.getState().onElementSelected({
      ...freshPayload("#title", { specifiedStyles: { color: "rgb(255, 0, 0)" } }),
      propSources: { color: "[inline]" },
    });

    expect(useEditorStore.getState().selection?.propSources).toEqual({
      color: ".swatch",
    });
  });

  it("재선택 후 추가 편집 → 다음 전환 시 이전 py 편집이 보존된다 (py-buffer-repro 회귀)", () => {
    useEditorStore.setState({
      selection: freshPayload("#title", { specifiedStyles: { "padding-top": "8px", "padding-bottom": "8px", "padding-left": "8px" } }),
      styleEdits: {
        classList: ["title"],
        inlineStyle: { "padding-top": "20px", "padding-bottom": "20px" },
        text: "",
      },
      beforeImage: "data:before-title",
    });
    useEditorStore.getState().bufferCurrentElement("data:after-title");

    // #title 재선택 → 편집 복원
    useEditorStore.getState().onElementSelected(freshPayload("#title"));
    // px(left) 한 면 추가
    useEditorStore.getState().setStyleEdits({
      inlineStyle: {
        ...useEditorStore.getState().styleEdits.inlineStyle,
        "padding-left": "10px",
      },
    });
    // 다음 요소로 전환 → 재버퍼
    useEditorStore.getState().bufferCurrentElement("data:after-title-2");

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf).toHaveLength(1);
    expect(buf[0].styleEdits.inlineStyle).toEqual({
      "padding-top": "20px",
      "padding-bottom": "20px",
      "padding-left": "10px",
    });
  });
});

describe("patchBufferedElement / removeBufferedElement", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  function seedBuffer(selector: string, inline: Record<string, string>) {
    useEditorStore.setState({
      selection: {
        selector,
        tagName: "button",
        classList: ["cta"],
        computedStyles: {},
        specifiedStyles: {},
        propSources: {},
        hasParent: true,
        hasChild: false,
        text: null,
        viewport: { width: 1440, height: 900 },
        capturedAt: 1,
      },
      styleEdits: { classList: ["cta"], inlineStyle: inline, text: "" },
      beforeImage: "data:before",
    });
    useEditorStore.getState().bufferCurrentElement("data:after");
  }

  it("patch: 일치 항목의 styleEdits만 갱신, 다른 항목은 불변", () => {
    seedBuffer("#a", { color: "#fff" });
    seedBuffer("#b", { margin: "8px" });

    const nextEdits = { classList: ["cta"], inlineStyle: {}, text: "" };
    useEditorStore.getState().patchBufferedElement("#a", 0, { styleEdits: nextEdits });

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf[0].styleEdits).toEqual(nextEdits);
    expect(buf[0].afterImage).toBe("data:after");
    expect(buf[1].styleEdits.inlineStyle).toEqual({ margin: "8px" });
  });

  it("patch: afterImage 단독 갱신", () => {
    seedBuffer("#a", { color: "#fff" });

    useEditorStore.getState().patchBufferedElement("#a", 0, { afterImage: "data:after-2" });

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf[0].afterImage).toBe("data:after-2");
    expect(buf[0].styleEdits.inlineStyle).toEqual({ color: "#fff" });
  });

  it("patch: styleEdits + afterImage 동시 갱신", () => {
    seedBuffer("#a", { color: "#fff" });

    const nextEdits = { classList: ["cta"], inlineStyle: {}, text: "" };
    useEditorStore.getState().patchBufferedElement("#a", 0, {
      styleEdits: nextEdits,
      afterImage: "data:after-2",
    });

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf[0].styleEdits).toEqual(nextEdits);
    expect(buf[0].afterImage).toBe("data:after-2");
  });

  it("patch: selector 미일치 시 no-op", () => {
    seedBuffer("#a", { color: "#fff" });
    const before = useEditorStore.getState().bufferedElements;

    useEditorStore.getState().patchBufferedElement("#none", 0, { afterImage: "x" });

    expect(useEditorStore.getState().bufferedElements).toEqual(before);
  });

  it("remove: 이미지 포함 항목 제거, 다른 항목 유지", () => {
    seedBuffer("#a", { color: "#fff" });
    seedBuffer("#b", { margin: "8px" });

    useEditorStore.getState().removeBufferedElement("#a", 0);

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf.map((b) => b.selector)).toEqual(["#b"]);
  });

  it("remove: selector 미일치 시 no-op", () => {
    seedBuffer("#a", { color: "#fff" });

    useEditorStore.getState().removeBufferedElement("#none", 0);

    expect(useEditorStore.getState().bufferedElements).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  iframe 지원 — frameId·origin 라우팅 + 버퍼 복합키 (selector+frameId)  */
/* ------------------------------------------------------------------ */

describe("iframe frameId·origin — selection·buffer 복합키", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  // frameId·origin을 실은 선택 payload (0 = top, ≠0 = iframe).
  function framedSelection(selector: string, frameId: number, origin: string) {
    return {
      selector,
      tagName: "button",
      classList: ["cta"],
      computedStyles: { color: "#000000" },
      specifiedStyles: {},
      propSources: {},
      hasParent: true,
      hasChild: false,
      text: null,
      viewport: { width: 1440, height: 900 },
      capturedAt: 1700000000000,
      frameId,
      origin,
    };
  }

  // patch/remove 복합키를 직접 겨냥하려 버퍼 배열을 setState로 주입(같은 selector, 다른 frameId).
  function bufferedEntry(selector: string, frameId: number, origin: string) {
    return {
      selector,
      tagName: "button",
      frameId,
      origin,
      selectionSnapshot: {
        classList: ["cta"],
        specifiedStyles: {},
        computedStyles: {},
        propSources: {},
        text: null,
        viewport: { width: 1440, height: 900 },
        capturedAt: 1,
      },
      styleEdits: { classList: ["cta"], inlineStyle: {}, text: "" },
      beforeImage: null,
      afterImage: null,
    };
  }

  it("onElementSelected가 selection에 frameId·origin을 싣는다", () => {
    useEditorStore
      .getState()
      .onElementSelected(
        framedSelection("#btn", 3, "https://iframe.example") as never,
      );

    const sel = useEditorStore.getState().selection!;
    expect(sel.frameId).toBe(3);
    expect(sel.origin).toBe("https://iframe.example");
  });

  it("버퍼 재선택 매칭이 selector+frameId 복합키 — 다른 frameId 동일 selector는 신규 선택", () => {
    // top(frameId 0)의 "#dup"을 편집·버퍼에 적재
    useEditorStore.setState({
      selection: framedSelection("#dup", 0, "https://page.example") as never,
      styleEdits: { classList: ["cta"], inlineStyle: { color: "#fff" }, text: "" },
      beforeImage: "data:before-top",
    });
    useEditorStore.getState().bufferCurrentElement("data:after-top");
    expect(useEditorStore.getState().bufferedElements).toHaveLength(1);

    // iframe(frameId 3)의 동일 selector "#dup" 선택 → top 버퍼를 건드리면 안 됨
    useEditorStore
      .getState()
      .onElementSelected(
        framedSelection("#dup", 3, "https://iframe.example") as never,
      );

    const s = useEditorStore.getState();
    // 신규 선택으로 취급 → inlineStyle 초기화
    expect(s.styleEdits.inlineStyle).toEqual({});
    // top 버퍼 항목은 승격 없이 그대로 유지
    expect(s.bufferedElements).toHaveLength(1);
    expect(s.bufferedElements[0].frameId).toBe(0);
  });

  it("bufferCurrentElement가 frameId·origin을 버퍼 항목에 복사한다", () => {
    useEditorStore.setState({
      selection: framedSelection("#btn", 5, "https://iframe.example") as never,
      styleEdits: { classList: ["cta"], inlineStyle: { color: "#fff" }, text: "" },
      beforeImage: "data:before",
    });

    useEditorStore.getState().bufferCurrentElement("data:after");

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf).toHaveLength(1);
    expect(buf[0].frameId).toBe(5);
    expect(buf[0].origin).toBe("https://iframe.example");
  });

  it("bufferCurrentElement dedup이 selector+frameId — 동일 selector 다른 frameId는 별개 항목", () => {
    useEditorStore.setState({
      selection: framedSelection("#d", 0, "https://page.example") as never,
      styleEdits: { classList: ["cta"], inlineStyle: { color: "#fff" }, text: "" },
      beforeImage: "data:before-0",
    });
    useEditorStore.getState().bufferCurrentElement("data:after-0");

    useEditorStore.setState({
      selection: framedSelection("#d", 3, "https://iframe.example") as never,
      styleEdits: { classList: ["cta"], inlineStyle: { margin: "8px" }, text: "" },
      beforeImage: "data:before-3",
    });
    useEditorStore.getState().bufferCurrentElement("data:after-3");

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf).toHaveLength(2);
    expect(buf.map((b) => b.frameId)).toEqual([0, 3]);
  });

  it("patchBufferedElement(selector, frameId)가 일치 프레임 항목만 갱신한다", () => {
    useEditorStore.setState({
      bufferedElements: [
        bufferedEntry("#dup", 0, "https://page.example"),
        bufferedEntry("#dup", 3, "https://iframe.example"),
      ] as never,
    });

    useEditorStore
      .getState()
      .patchBufferedElement("#dup", 0, { afterImage: "data:patched" });

    const buf = useEditorStore.getState().bufferedElements;
    const top = buf.find((b) => b.frameId === 0)!;
    const iframe = buf.find((b) => b.frameId === 3)!;
    expect(top.afterImage).toBe("data:patched");
    expect(iframe.afterImage).toBeNull();
  });

  it("removeBufferedElement(selector, frameId)가 일치 프레임 항목만 제거한다", () => {
    useEditorStore.setState({
      bufferedElements: [
        bufferedEntry("#dup", 0, "https://page.example"),
        bufferedEntry("#dup", 3, "https://iframe.example"),
      ] as never,
    });

    useEditorStore.getState().removeBufferedElement("#dup", 0);

    const buf = useEditorStore.getState().bufferedElements;
    expect(buf).toHaveLength(1);
    expect(buf[0].frameId).toBe(3);
  });

  it("updateSelectionStyles가 다른 frameId의 동일 selector 보강을 무시한다", () => {
    useEditorStore.setState({
      selection: {
        ...framedSelection("#el", 0, "https://page.example"),
        specifiedStyles: { color: "rgb(0, 0, 255)" },
        computedStyles: { color: "rgb(0, 0, 255)" },
        propSources: { color: ".top" },
      } as never,
    });

    // iframe(frameId 3)의 동일 selector 보강이 top(frameId 0) 선택에 도착 → 무시돼야
    useEditorStore.getState().updateSelectionStyles({
      selector: "#el",
      frameId: 3,
      specifiedStyles: { color: "rgb(255, 0, 0)" },
      computedStyles: { color: "rgb(255, 0, 0)" },
      propSources: { color: ".iframe" },
    } as never);

    const sel = useEditorStore.getState().selection!;
    expect(sel.specifiedStyles.color).toBe("rgb(0, 0, 255)");
  });
});

describe("mergeSelectionStyles — class 편집 후 baseline 오염 방지", () => {
  it("편집 중 prop은 재수집 패치의 인라인 오염값 대신 원본 baseline 유지", () => {
    const prev = {
      specifiedStyles: { color: "rgb(50, 50, 50)" },
      computedStyles: { color: "rgb(50, 50, 50)", "padding-top": "0px" },
      propSources: { color: ".swatch" },
    };
    // class 편집 후 picker.selectionUpdated: 인라인 편집값(color/padding-top)이 새어든 패치
    const patch = {
      specifiedStyles: { color: "rgb(255, 0, 0)", "padding-top": "20px" },
      computedStyles: { color: "rgb(255, 0, 0)", "padding-top": "20px" },
      propSources: { color: "[inline]", "padding-top": "[inline]" },
    };
    const inlineEdits = { color: "rgb(255, 0, 0)", "padding-top": "20px" };

    const merged = mergeSelectionStyles(prev, patch, inlineEdits);

    // 원본에 있던 color → baseline 값 복원
    expect(merged.specifiedStyles.color).toBe("rgb(50, 50, 50)");
    // 원본 specified에 없던 padding-top → 제거 (computed 폴백이 원본 0px 가리키게)
    expect(merged.specifiedStyles["padding-top"]).toBeUndefined();
    expect(merged.computedStyles["padding-top"]).toBe("0px");
    expect(merged.propSources.color).toBe(".swatch");
    expect(merged.propSources["padding-top"]).toBeUndefined();
  });

  it("편집 안 한 prop은 재수집 패치값을 그대로 반영 (class 변경으로 바뀐 규칙)", () => {
    const prev = {
      specifiedStyles: { color: "rgb(50, 50, 50)" },
      computedStyles: { color: "rgb(50, 50, 50)" },
      propSources: { color: ".swatch" },
    };
    const patch = {
      specifiedStyles: { color: "rgb(50, 50, 50)", "background-color": "rgb(0, 0, 255)" },
      computedStyles: { color: "rgb(50, 50, 50)", "background-color": "rgb(0, 0, 255)" },
      propSources: { color: ".swatch", "background-color": ".active" },
    };
    // color만 편집 중, background-color는 class 변경으로 새로 매칭된 규칙
    const merged = mergeSelectionStyles(prev, patch, { color: "rgb(255, 0, 0)" });

    expect(merged.specifiedStyles.color).toBe("rgb(50, 50, 50)");
    expect(merged.specifiedStyles["background-color"]).toBe("rgb(0, 0, 255)");
  });
});

describe("updateSelectionStyles — 편집 중 prop baseline 보존", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("스타일 편집 후 selectionUpdated가 와도 편집 prop의 diff 전값이 원본으로 유지된다", () => {
    useEditorStore.setState({
      selection: {
        selector: "#el1",
        tagName: "div",
        classList: ["swatch"],
        specifiedStyles: { color: "rgb(50, 50, 50)" },
        computedStyles: { color: "rgb(50, 50, 50)", "padding-top": "0px" },
        propSources: { color: ".swatch" },
        hasParent: true,
        hasChild: false,
        text: null,
        viewport: { width: 1440, height: 900 },
        capturedAt: 1700000000000,
      },
      styleEdits: {
        classList: ["swatch"],
        inlineStyle: { color: "rgb(255, 0, 0)", "padding-top": "20px" },
        text: "",
      },
    });

    // class 편집이 유발한 selectionUpdated (인라인이 새어든 specified/computed)
    useEditorStore.getState().updateSelectionStyles({
      selector: "#el1",
      specifiedStyles: { color: "rgb(255, 0, 0)", "padding-top": "20px" },
      computedStyles: { color: "rgb(255, 0, 0)", "padding-top": "20px" },
      propSources: { color: "[inline]", "padding-top": "[inline]" },
    });

    const sel = useEditorStore.getState().selection!;
    expect(sel.specifiedStyles.color).toBe("rgb(50, 50, 50)");
    expect(sel.specifiedStyles["padding-top"]).toBeUndefined();
    expect(sel.computedStyles["padding-top"]).toBe("0px");
  });

  it("선택자가 다른 stale 보강은 무시된다 (요소 전환 후 늦게 도착한 cross-origin)", () => {
    useEditorStore.setState({
      selection: {
        selector: "#el-B",
        tagName: "div",
        classList: [],
        specifiedStyles: { color: "rgb(0, 0, 255)" },
        computedStyles: { color: "rgb(0, 0, 255)" },
        propSources: { color: ".b" },
        hasParent: true,
        hasChild: false,
        text: null,
        viewport: { width: 1440, height: 900 },
        capturedAt: 1700000000000,
      },
    });

    // #el-A를 선택했을 때 만들어진 보강이 #el-B 선택 중 뒤늦게 도착.
    useEditorStore.getState().updateSelectionStyles({
      selector: "#el-A",
      specifiedStyles: { padding: "99px" },
      computedStyles: { padding: "99px" },
      propSources: { padding: ".a" },
    });

    const sel = useEditorStore.getState().selection!;
    expect(sel.selector).toBe("#el-B");
    expect(sel.specifiedStyles.color).toBe("rgb(0, 0, 255)");
    expect(sel.specifiedStyles.padding).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  annotationTool/Color/Thickness — 녹화 중 그리기 툴바 상태            */
/* ------------------------------------------------------------------ */

describe("annotationTool/Color/Thickness — 녹화 그리기 툴바 상태", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("초기값: tool=null(off), color=기본 빨강, thickness=M", () => {
    expect(useEditorStore.getState().annotationTool).toBe(null);
    expect(useEditorStore.getState().annotationColor).toBe("#ef4444");
    expect(useEditorStore.getState().annotationThickness).toBe("M");
  });

  it("setAnnotationTool로 pen/highlight를 켜고 null로 끈다", () => {
    useEditorStore.getState().setAnnotationTool("pen");
    expect(useEditorStore.getState().annotationTool).toBe("pen");

    useEditorStore.getState().setAnnotationTool("highlight");
    expect(useEditorStore.getState().annotationTool).toBe("highlight");

    useEditorStore.getState().setAnnotationTool(null);
    expect(useEditorStore.getState().annotationTool).toBe(null);
  });

  it("setAnnotationColor / setAnnotationThickness로 스타일을 바꾼다", () => {
    useEditorStore.getState().setAnnotationColor("#3b82f6");
    expect(useEditorStore.getState().annotationColor).toBe("#3b82f6");

    useEditorStore.getState().setAnnotationThickness("L");
    expect(useEditorStore.getState().annotationThickness).toBe("L");
  });

  it("startRecording은 ...initial 리셋이라 tool을 null로 되돌린다", () => {
    useEditorStore.getState().setAnnotationTool("pen");
    expect(useEditorStore.getState().annotationTool).toBe("pen");

    useEditorStore.getState().startRecording(target, "tab");

    expect(useEditorStore.getState().phase).toBe("recording");
    expect(useEditorStore.getState().annotationTool).toBe(null);
  });
});

/* ------------------------------------------------------------------ */
/*  confirmDraft jira — 기본 담당자 prefill                            */
/* ------------------------------------------------------------------ */

// 담당자는 "직전 제출값 우선, 없으면 Connect 기본값"이다(POSTMORTEM 2026-06-27: defaults가 last를
// 가리면 안 된다). last 복원 게이트(사용자가 이미 고른 값 보호)가 이 우선순위를 뒤집으면
// 조용히 *다른 사람*이 담당자로 붙는다.
describe("confirmDraft jira — 기본 담당자 prefill", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    mockSaveDraft.mockClear();
    settingsState.current = { lastSubmitFields: {}, accounts: {} };
  });

  // 가변 mock이라 뒤에 describe가 추가되면 상태가 샌다 — 기본값으로 되돌린다.
  afterEach(() => {
    settingsState.current = { lastSubmitFields: {}, accounts: {} };
  });

  function seedJira(last: Record<string, unknown>, account: Record<string, unknown>) {
    settingsState.current = {
      lastSubmitFields: { jira: last },
      accounts: { jira: { platform: "jira", ...account } },
    };
    useEditorStore.setState({
      target,
      targetPlatform: "jira",
      captureMode: "screenshot",
      screenshotRaw: "data:image/webp;base64,x",
      draft: { title: "Jira assignee prefill", sections: {} },
    });
  }

  it("직전 제출 담당자가 Connect 기본 담당자보다 우선한다", () => {
    seedJira(
      { projectKey: "ENG", assigneeId: "lastUser", assigneeName: "Last" },
      { projectKey: "ENG", assigneeId: "dflt", assigneeName: "Default" },
    );
    useEditorStore.getState().confirmDraft();
    expect(useEditorStore.getState().issueFields.assigneeId).toBe("lastUser");
  });

  it("우선순위만 미리 골라둬도 직전 제출 담당자가 유지된다 (기본값이 가로채지 않는다)", () => {
    seedJira(
      { projectKey: "ENG", assigneeId: "lastUser", assigneeName: "Last" },
      { projectKey: "ENG", assigneeId: "dflt", assigneeName: "Default" },
    );
    // 세션 중 우선순위만 선택 — last 복원 게이트가 닫히는 조건.
    useEditorStore.setState({ issueFields: { priorityId: "3" } });

    useEditorStore.getState().confirmDraft();

    const fields = useEditorStore.getState().issueFields;
    expect(fields.assigneeId).toBe("lastUser");
    expect(fields.assigneeName).toBe("Last");
    expect(fields.priorityId).toBe("3");
  });

  it("직전 제출 담당자가 없으면 Connect 기본 담당자로 채운다", () => {
    seedJira({ projectKey: "ENG" }, { projectKey: "ENG", assigneeId: "dflt", assigneeName: "Default" });
    useEditorStore.getState().confirmDraft();
    expect(useEditorStore.getState().issueFields.assigneeId).toBe("dflt");
  });

  it("사용자가 이미 고른 담당자를 덮지 않는다", () => {
    seedJira(
      { projectKey: "ENG", assigneeId: "lastUser" },
      { projectKey: "ENG", assigneeId: "dflt" },
    );
    useEditorStore.setState({ issueFields: { assigneeId: "picked", assigneeName: "Picked" } });

    useEditorStore.getState().confirmDraft();

    expect(useEditorStore.getState().issueFields.assigneeId).toBe("picked");
  });

  it("issueFields에 projectKey가 새지 않는다 (EditorIssueFields에 없는 키 — 세션 영속 오염)", () => {
    seedJira({ projectKey: "ENG", assigneeId: "lastUser" }, { projectKey: "ENG" });
    useEditorStore.getState().confirmDraft();
    expect(useEditorStore.getState().issueFields).not.toHaveProperty("projectKey");
  });
});

describe("aiCancel — 진행 중 AI 작업의 취소 콜백 레지스트리", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it("초기값은 null", () => {
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });

  it("setAiCancel로 콜백을 등록/해제한다", () => {
    const fn = vi.fn();
    useEditorStore.getState().setAiCancel(fn);
    expect(useEditorStore.getState().aiCancel).toBe(fn);
    useEditorStore.getState().setAiCancel(null);
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });

  it("reset이 aiCancel을 청소한다 (재캡처 시 stale 콜백 잔류 방지)", () => {
    useEditorStore.getState().setAiCancel(vi.fn());
    useEditorStore.getState().reset();
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });
});
