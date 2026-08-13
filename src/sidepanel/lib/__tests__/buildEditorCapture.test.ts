import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionLog } from "@/types/action";

// buildEditorMarkdownContext는 store에서 직접 읽는다 — getState만 모킹해 순수 판정부를 검증.
const editorState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/store/editor-store", () => ({
  useEditorStore: { getState: () => editorState.current },
}));
// 본문 언어는 이 함수가 store에서 직접 읽는다 — 케이스마다 갈아끼울 수 있게 ref로 둔다.
const settingsState = vi.hoisted(() => ({
  current: { issueSections: [], locale: "ko", bodyLocale: "auto" } as Record<string, unknown>,
}));

vi.mock("@/store/settings-ui-store", () => ({
  useSettingsUiStore: { getState: () => settingsState.current },
}));
vi.mock("@/sidepanel/lib/osInfo", () => ({
  getOsInfo: () => ({ name: "macOS", version: "15" }),
}));
vi.mock("@/store/blob-db", () => ({
  blobToDataUrl: () => Promise.resolve("data:x"),
  dataUrlToBlob: () => new Blob(),
}));
vi.mock("@/i18n", () => ({
  // 빌더 진입점이 withLocale로 감싸져 있다 — 모킹에서 빠지면 통째로 죽는다(패스스루).
  withLocale: <T>(_locale: string, fn: () => T): T => fn(),
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36" });

import {
  buildEditorLogsCaptureInput,
  buildEditorMarkdownContext,
} from "../buildEditorCapture";
import type { MarkdownContext } from "../buildIssueMarkdown";

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
    consoleLog: null,
    actionLog,
    logsAttach: true,
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

  it("logsAttach=false면 모드 무관하게 undefined (사용자 토글 존중)", () => {
    editorState.current = baseState({ captureMode: "screenshot", logsAttach: false });
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

/* ------------------------------------------------------------------ */
/*  diff 이미지 주석 — 제출 경로 resolve(annotated ?? raw)               */
/* ------------------------------------------------------------------ */

describe("buildEditorMarkdownContext — element annotated 전달", () => {
  function elementState(overrides: Record<string, unknown> = {}) {
    return baseState({
      captureMode: "element",
      selection: {
        selector: "button.cta",
        frameId: 0,
        tagName: "button",
        classList: [],
        computedStyles: { color: "#000000" },
        specifiedStyles: {},
        propSources: {},
        text: null,
        viewport: { width: 800, height: 600 },
        capturedAt: 0,
      },
      styleEdits: { classList: [], inlineStyle: { color: "#ffffff" }, text: "" },
      bufferedElements: [],
      beforeImage: "data:before",
      afterImage: "data:after",
      tokens: [],
      ...overrides,
    });
  }

  beforeEach(() => {
    editorState.current = {};
  });

  // 안 넘기면 미리보기·제출이 원본으로 되돌아간다(표시 쪽이 접는 지점을 잃는다).
  it("top-level annotated 두 필드를 styleElements에 그대로 싣는다", () => {
    editorState.current = elementState({
      beforeAnnotated: "data:before-ann",
      afterAnnotated: "data:after-ann",
    });

    const ctx = buildEditorMarkdownContext();

    expect(ctx?.styleElements?.[0].beforeImage).toBe("data:before");
    expect(ctx?.styleElements?.[0].beforeAnnotated).toBe("data:before-ann");
    expect(ctx?.styleElements?.[0].afterAnnotated).toBe("data:after-ann");
  });

  it("주석이 없으면 annotated는 비어 있다", () => {
    editorState.current = elementState();

    const ctx = buildEditorMarkdownContext();

    expect(ctx?.styleElements?.[0].beforeAnnotated ?? null).toBeNull();
    expect(ctx?.styleElements?.[0].afterAnnotated ?? null).toBeNull();
  });
});

describe("buildEditorLogsCaptureInput — before/after 이미지 resolve", () => {
  function ctxWith(styleElements: MarkdownContext["styleElements"]): MarkdownContext {
    return {
      bodyLocale: "ko",
      captureMode: "element",
      title: "T",
      sections: {},
      sectionConfig: [],
      url: "https://example.com",
      selector: "button.cta",
      tagName: "button",
      classListBefore: [],
      classListAfter: [],
      specifiedStyles: {},
      tokens: [],
      viewport: { width: 800, height: 600 },
      capturedAt: 0,
      diffs: [],
      environment: [],
      styleElements,
    };
  }

  beforeEach(() => {
    editorState.current = baseState({ captureMode: "element" });
  });

  it("주석이 있으면 beforeImages/afterImages가 주석본이다", () => {
    const input = buildEditorLogsCaptureInput(
      ctxWith([
        {
          selector: "button.cta",
          tagName: "button",
          classListBefore: [],
          classListAfter: [],
          specifiedStyles: {},
          diffs: [],
          beforeImage: "data:before",
          afterImage: "data:after",
          beforeAnnotated: "data:before-ann",
          afterAnnotated: "data:after-ann",
        },
      ]),
    );

    expect(input.beforeImages).toEqual(["data:before-ann"]);
    expect(input.afterImages).toEqual(["data:after-ann"]);
  });

  it("주석이 없으면 원본이 들어간다", () => {
    const input = buildEditorLogsCaptureInput(
      ctxWith([
        {
          selector: "button.cta",
          tagName: "button",
          classListBefore: [],
          classListAfter: [],
          specifiedStyles: {},
          diffs: [],
          beforeImage: "data:before",
          afterImage: "data:after",
        },
      ]),
    );

    expect(input.beforeImages).toEqual(["data:before"]);
    expect(input.afterImages).toEqual(["data:after"]);
  });

  // 현재+버퍼 혼합에서 인덱스가 어긋나면 before-0.webp에 다른 요소의 주석본이 실린다.
  it("현재+버퍼 혼합에서 각 annotated가 같은 인덱스로 들어간다", () => {
    const input = buildEditorLogsCaptureInput(
      ctxWith([
        {
          selector: ".card",
          tagName: "div",
          classListBefore: [],
          classListAfter: [],
          specifiedStyles: {},
          diffs: [],
          beforeImage: "data:b0",
          afterImage: "data:a0",
          afterAnnotated: "data:a0-ann",
        },
        {
          selector: "button.cta",
          tagName: "button",
          classListBefore: [],
          classListAfter: [],
          specifiedStyles: {},
          diffs: [],
          beforeImage: "data:b1",
          afterImage: "data:a1",
          beforeAnnotated: "data:b1-ann",
        },
      ]),
    );

    expect(input.beforeImages).toEqual(["data:b0", "data:b1-ann"]);
    expect(input.afterImages).toEqual(["data:a0-ann", "data:a1"]);
  });

  it("raw가 없고 annotated만 있어도 그 값이 들어간다", () => {
    const input = buildEditorLogsCaptureInput(
      ctxWith([
        {
          selector: "button.cta",
          tagName: "button",
          classListBefore: [],
          classListAfter: [],
          specifiedStyles: {},
          diffs: [],
          beforeImage: null,
          afterImage: null,
          beforeAnnotated: "data:only-ann",
        },
      ]),
    );

    expect(input.beforeImages).toEqual(["data:only-ann"]);
    expect(input.afterImages).toEqual([null]);
  });
});

// 제출 경로의 MarkdownContext 생산지. "auto"는 여기서 화면 언어로 해석돼 들어가야 한다 —
// ctx에 "auto"가 실리면 해석 지점이 생산지마다 갈린다.
describe("buildEditorMarkdownContext — bodyLocale (제출 경로 생산지)", () => {
  beforeEach(() => {
    editorState.current = baseState({ captureMode: "screenshot" });
    settingsState.current = { issueSections: [], locale: "ko", bodyLocale: "auto" };
  });

  it("bodyLocale en + 화면 ko → ctx.bodyLocale은 en", () => {
    settingsState.current = { issueSections: [], locale: "ko", bodyLocale: "en" };
    expect(buildEditorMarkdownContext()?.bodyLocale).toBe("en");
  });

  it("bodyLocale auto → 화면 언어로 해석된다", () => {
    settingsState.current = { issueSections: [], locale: "ko", bodyLocale: "auto" };
    expect(buildEditorMarkdownContext()?.bodyLocale).toBe("ko");

    settingsState.current = { issueSections: [], locale: "en", bodyLocale: "auto" };
    expect(buildEditorMarkdownContext()?.bodyLocale).toBe("en");
  });

  it("오염된 저장값은 auto로 교정된 뒤 화면 언어로 해석된다", () => {
    settingsState.current = { issueSections: [], locale: "ko", bodyLocale: "jp" };
    expect(buildEditorMarkdownContext()?.bodyLocale).toBe("ko");
  });
});
