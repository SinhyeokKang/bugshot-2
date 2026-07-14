import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionLog } from "@/types/action";

// buildEditorMarkdownContext는 store에서 직접 읽는다 — getState만 모킹해 순수 판정부를 검증.
const editorState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/store/editor-store", () => ({
  useEditorStore: { getState: () => editorState.current },
}));
vi.mock("@/store/settings-ui-store", () => ({
  useSettingsUiStore: { getState: () => ({ issueSections: [] }) },
}));
vi.mock("@/sidepanel/lib/osInfo", () => ({
  getOsInfo: () => ({ name: "macOS", version: "15" }),
}));
vi.mock("@/store/blob-db", () => ({
  blobToDataUrl: () => Promise.resolve("data:x"),
  dataUrlToBlob: () => new Blob(),
}));
vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36" });

import { buildEditorMarkdownContext } from "../buildEditorCapture";

const actionLog: ActionLog = {
  id: "act-1",
  startedAt: 0,
  endedAt: 1000,
  totalSeen: 3,
  captured: 3,
  entries: [
    { id: "ae-1", kind: "click", timestamp: 500, pageUrl: "https://example.com", target: "저장" },
  ],
};

// 로그 판정에 필요한 최소 state. captureMode별 뷰포트/시각 필드는 각 분기에서 읽는다.
function baseState(overrides: Record<string, unknown> = {}) {
  return {
    draft: { title: "T", sections: {}, environment: [] },
    target: { url: "https://example.com" },
    networkLog: null,
    networkLogAttach: false,
    consoleLog: null,
    consoleLogAttach: false,
    actionLog,
    actionLogAttach: true,
    shotSelector: null,
    screenshotViewport: { width: 800, height: 600 },
    screenshotCapturedAt: 1_700_000_000_000,
    freeformViewport: { width: 800, height: 600 },
    freeformCapturedAt: 1_700_000_000_000,
    videoViewport: { width: 800, height: 600 },
    videoCapturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("buildEditorMarkdownContext — actionLogCaptured (본문 요약 연결)", () => {
  beforeEach(() => {
    editorState.current = {};
  });

  // 계약 확장(v1.5.8): 액션 로그가 screenshot/freeform에도 붙는다.
  // 본문 요약(logSummary.action.line)과 logs.html 링크는 ctx.actionLogCaptured로 결정되므로,
  // 여기가 undefined면 첨부는 생성돼도 본문이 참조를 잃는다 (POSTMORTEM 2026-06-25의 고아 첨부).
  it("screenshot + 액션 로그만 → actionLogCaptured 채워짐", () => {
    editorState.current = baseState({ captureMode: "screenshot" });
    const ctx = buildEditorMarkdownContext();
    expect(ctx?.captureMode).toBe("screenshot");
    expect(ctx?.actionLogCaptured).toBe(3);
  });

  it("freeform + 액션 로그만 → actionLogCaptured 채워짐", () => {
    editorState.current = baseState({ captureMode: "freeform" });
    const ctx = buildEditorMarkdownContext();
    expect(ctx?.captureMode).toBe("freeform");
    expect(ctx?.actionLogCaptured).toBe(3);
  });

  it("video → actionLogCaptured 채워짐 (기존 동작 불변)", () => {
    editorState.current = baseState({ captureMode: "video" });
    const ctx = buildEditorMarkdownContext();
    expect(ctx?.actionLogCaptured).toBe(3);
  });

  it("actionLogAttach=false면 모드 무관하게 undefined (사용자 토글 존중)", () => {
    editorState.current = baseState({ captureMode: "screenshot", actionLogAttach: false });
    expect(buildEditorMarkdownContext()?.actionLogCaptured).toBeUndefined();
  });

  it("captured=0이면 undefined (빈 로그는 요약 줄 없음)", () => {
    editorState.current = baseState({
      captureMode: "screenshot",
      actionLog: { ...actionLog, captured: 0, entries: [] },
    });
    expect(buildEditorMarkdownContext()?.actionLogCaptured).toBeUndefined();
  });
});
