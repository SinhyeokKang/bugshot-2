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

/* ------------------------------------------------------------------ */
/*  environment — API Hosts 자동 행 게이트 (제출 ctx의 2차 방어)          */
/* ------------------------------------------------------------------ */

// 이 게이트의 진짜 그물. bodyOutputGolden은 ctx 리터럴을 직접 조립해 이 경로를 지나지 않고,
// 기존 케이스도 environment: []뿐이라 커버리지가 0이었다.
describe("buildEditorMarkdownContext — environment API Hosts 게이트", () => {
  const userRow = { label: "Locale", value: "ko-KR" };
  const autoRow = {
    label: "API Hosts",
    value: "api.acme.com",
    source: "api-hosts" as const,
  };

  function envState(overrides: Record<string, unknown> = {}) {
    return baseState({
      captureMode: "screenshot",
      draft: { title: "T", sections: {}, environment: [userRow, autoRow] },
      apiHostsDerived: "api.acme.com",
      ...overrides,
    });
  }

  beforeEach(() => {
    editorState.current = {};
    settingsState.current = { issueSections: [], locale: "ko", bodyLocale: "auto" };
  });

  it("로그 첨부 ON이면 자동 행이 본문 ctx에 남는다", () => {
    editorState.current = envState({ logsAttach: true });

    expect(buildEditorMarkdownContext()?.environment).toEqual([userRow, autoRow]);
  });

  it("로그 첨부 OFF면 자동 행이 제거된다", () => {
    editorState.current = envState({ logsAttach: false });

    expect(buildEditorMarkdownContext()?.environment).toEqual([userRow]);
  });

  it("사용자가 값을 고친 행은 로그 첨부 OFF여도 남는다", () => {
    const edited = { ...autoRow, value: "내가-고친.acme.com" };
    editorState.current = envState({
      logsAttach: false,
      draft: { title: "T", sections: {}, environment: [userRow, edited] },
    });

    expect(buildEditorMarkdownContext()?.environment).toEqual([userRow, edited]);
  });

  it("element 모드는 로그 첨부 ON이어도 자동 행이 제거된다 (모드 게이트)", () => {
    editorState.current = envState({
      captureMode: "element",
      logsAttach: true,
      selection: {
        selector: "button.cta",
        frameId: 0,
        tagName: "button",
        classList: [],
        computedStyles: {},
        specifiedStyles: {},
        propSources: {},
        text: null,
        viewport: { width: 800, height: 600 },
        capturedAt: 0,
      },
      styleEdits: { classList: [], inlineStyle: {}, text: "" },
      bufferedElements: [],
      tokens: [],
    });

    expect(buildEditorMarkdownContext()?.environment).toEqual([userRow]);
  });
});

/* ------------------------------------------------------------------ */
/*  로그 요약 생산자 축 — 에러 0건 세션                                  */
/* ------------------------------------------------------------------ */

// bodyOutputEdgeAxes.test.ts의 축 B/B-2가 보는 건 "ctx에 errorCount 0이 실리면 빌더가
// lineNoError를 그리는가"(소비자)뿐이다. 그 반대편 — 실제 에러 없는 세션이 errorCount 0을
// **만드는가** — 이 없으면 둘 다 green인 채로 본문이 영원히 with-error 분기를 탈 수 있다.
describe("buildEditorMarkdownContext — 에러 0건 세션 (본문 lineNoError의 생산자 축)", () => {
  const req = (over: Record<string, unknown> = {}) => ({
    id: "r-1",
    url: "https://example.com/api/items",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: 0,
    durationMs: 10,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://example.com",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete" as const,
    ...over,
  });

  const netLog = (requests: ReturnType<typeof req>[]) => ({
    id: "net-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: requests.length,
    captured: requests.length,
    warnings: [],
    requests,
  });

  const conLog = (levels: string[]) => ({
    id: "con-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: levels.length,
    captured: levels.length,
    entries: levels.map((level, i) => ({
      id: `ce-${i}`,
      level,
      timestamp: i,
      args: `msg-${i}`,
      pageUrl: "https://example.com",
    })),
  });

  beforeEach(() => {
    editorState.current = {};
    settingsState.current = { issueSections: [], locale: "ko", bodyLocale: "auto" };
  });

  it("성공 요청·정보 로그만인 세션 → errorCount 0 · errors 빈 배열 · warnCount 0", () => {
    editorState.current = baseState({
      captureMode: "screenshot",
      networkLog: netLog([req(), req({ id: "r-2", status: 304 })]),
      consoleLog: conLog(["log", "info", "debug"]),
    });

    const ctx = buildEditorMarkdownContext();

    expect(ctx?.networkLogSummary).toEqual({ captured: 2, errorCount: 0, errors: [] });
    expect(ctx?.consoleLogSummary).toEqual({
      captured: 3,
      errorCount: 0,
      warnCount: 0,
      topErrors: [],
    });
  });

  it("경고만 있는 세션 → errorCount 0 · warnCount는 실제 건수 (축 B-2의 생산자)", () => {
    editorState.current = baseState({
      captureMode: "screenshot",
      networkLog: netLog([req()]),
      consoleLog: conLog(["warn", "warn", "log"]),
    });

    const ctx = buildEditorMarkdownContext();

    expect(ctx?.consoleLogSummary?.errorCount).toBe(0);
    expect(ctx?.consoleLogSummary?.warnCount).toBe(2);
    expect(ctx?.consoleLogSummary?.topErrors).toEqual([]);
  });

  it("대조군 — 4xx/5xx와 error 로그가 있으면 errorCount가 채워진다", () => {
    editorState.current = baseState({
      captureMode: "screenshot",
      networkLog: netLog([
        req(),
        req({ id: "r-2", status: 500, statusText: "Server Error" }),
        req({ id: "r-3", status: 0, statusText: "Network Error", phase: "error" }),
      ]),
      consoleLog: conLog(["error", "warn", "log"]),
    });

    const ctx = buildEditorMarkdownContext();

    expect(ctx?.networkLogSummary?.errorCount).toBe(2);
    expect(ctx?.networkLogSummary?.errors).toHaveLength(2);
    expect(ctx?.consoleLogSummary?.errorCount).toBe(1);
    expect(ctx?.consoleLogSummary?.warnCount).toBe(1);
  });
});
