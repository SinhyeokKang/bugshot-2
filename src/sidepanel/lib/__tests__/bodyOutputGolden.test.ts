import { describe, it, expect, vi } from "vitest";

// 본문 출력 회귀망 — 8개 플랫폼 빌더 + 클립보드 md/html + 프리뷰 레이아웃을 한 파일에서 봉인한다.
// 빌더는 8곳에 흩어져 있어 한 곳만 고치면 나머지가 조용히 빠진다(POSTMORTEM 2026-06-25).
// 기대값은 `id:"media"` 엔트리 도입(body-composition-reorder) **이전** 출력에서 박제됐고,
// 리팩터 후 무수정으로 통과했다 — 기본 순서 출력이 바이트 동일함의 증거다.
// 스냅샷이 깨지면 먼저 "본문이 실제로 바뀌어야 하는 변경인가"를 답하고, 아니면 코드를 고친다.

// 타임스탬프는 실행 머신 TZ·로케일에 의존한다(POSTMORTEM 2026-07-16 toLocaleString 함정).
// 골든의 관심사는 블록 순서라 포맷은 고정 문자열로 대체한다 — formatTimestamp 자체는 전용 테스트가 검증.
vi.mock("../formatTimestamp", () => ({
  formatTimestamp: () => "2023-11-14 22:13:20 GMT+9",
}));

vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
  dateBcp47: () => "en-US",
}));

// settings-ui-store는 **모킹하지 않는다** — 골든이 봉인해야 하는 대상이 실제
// DEFAULT_ISSUE_SECTIONS(+ 그 순서 규칙)이기 때문. 모킹하면 마이그레이션 후 기본 순서가
// 골든에 반영되지 않아 사후 추인이 된다.
import {
  DEFAULT_ISSUE_SECTIONS,
  type IssueSection,
  type IssueSectionId,
} from "@/store/settings-ui-store";
import {
  buildIssueMarkdown,
  buildIssueHtml,
  type MarkdownContext,
} from "../buildIssueMarkdown";
import { buildMarkdownIssueBody } from "../buildMarkdownIssueBody";
import { buildIssueAdf } from "../buildIssueAdf";
import { buildNotionIssueBody } from "../buildNotionIssueBody";
import { buildAsanaIssueBody } from "../buildAsanaIssueBody";
import { buildClickupIssueBody } from "../buildClickupIssueBody";
import { buildLinearIssueBody } from "../buildLinearIssueBody";
import { buildSlackBody } from "../buildSlackBody";
import { composePreviewLayout } from "../composePreviewLayout";

type Mode = NonNullable<MarkdownContext["captureMode"]>;

const MODES: Mode[] = ["element", "screenshot", "video", "freeform"];

const LOG_SUMMARIES = {
  networkLogSummary: {
    captured: 12,
    errorCount: 3,
    errors: [
      { id: "n1", method: "GET", path: "/api/items", status: 500, statusText: "Server Error" },
    ],
  },
  consoleLogSummary: {
    captured: 8,
    errorCount: 2,
    warnCount: 1,
    topErrors: [{ id: "c1", message: "TypeError: x is not a function" }],
  },
  actionLogCaptured: 5,
} satisfies Partial<MarkdownContext>;

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    os: "macOS 15.5",
    browser: "Chrome 138",
    captureMode: "element",
    title: "Golden Issue",
    sections: {
      description: "버튼이 눌리지 않음",
      stepsToReproduce: "1단계 진입\n2단계 클릭",
      expectedResult: "버튼이 눌린다",
      notes: "비고 내용",
    },
    sectionConfig: DEFAULT_ISSUE_SECTIONS,
    url: "https://example.com/page",
    selector: "div.container > button",
    tagName: "button",
    classListBefore: ["btn"],
    classListAfter: ["btn", "btn-primary"],
    specifiedStyles: { color: "#000" },
    tokens: [{ name: "--brand", value: "#4f46e5" }],
    viewport: { width: 1920, height: 1080 },
    capturedAt: 1700000000000,
    diffs: [
      { prop: "color", asIs: "#000", toBe: "#fff" },
      {
        prop: "class",
        asIs: "btn",
        toBe: "btn btn-primary",
        asIsSegments: [{ text: "btn", changed: false }],
        toBeSegments: [
          { text: "btn", changed: false },
          { text: "btn-primary", changed: true },
        ],
      },
    ],
    environment: [{ label: "Locale", value: "ko-KR" }],
    ...LOG_SUMMARIES,
    ...overrides,
  };
}

// 기본 배열에서 enabled만 바꾼다 — media 엔트리(리팩터 후 추가)는 enabled와 무관하므로
// 리팩터 전후 모두 같은 의미를 갖는다.
function withEnabled(patch: Partial<Record<IssueSectionId, boolean>>): IssueSection[] {
  return DEFAULT_ISSUE_SECTIONS.map((s) =>
    s.id in patch ? { ...s, enabled: patch[s.id]! } : s,
  );
}

const hasImage = (mode: Mode) => mode === "screenshot" || mode === "element";
const hasVideo = (mode: Mode) => mode === "video";

const mdImages = (mode: Mode) =>
  hasImage(mode)
    ? [{ filename: "capture-0.webp", contentType: "image/webp", url: "https://cdn.test/c0.webp" }]
    : [];
const mdVideo = (mode: Mode) =>
  hasVideo(mode)
    ? { filename: "recording.mp4", contentType: "video/mp4", url: "https://cdn.test/r.mp4" }
    : undefined;
const mdLogs = [
  { filename: "logs.html", contentType: "text/html", url: "https://cdn.test/logs.html" },
];

// 빌더별 호출 어댑터. 리팩터 시 **여기만** 바뀔 수 있고 기대값(.snap)은 불변이어야 한다.
const OUTPUTS: { name: string; run: (ctx: MarkdownContext, mode: Mode) => unknown }[] = [
  { name: "buildIssueMarkdown", run: (ctx) => buildIssueMarkdown(ctx) },
  { name: "buildIssueHtml", run: (ctx) => buildIssueHtml(ctx) },
  {
    name: "buildMarkdownIssueBody(github)",
    run: (ctx, mode) =>
      buildMarkdownIssueBody(
        { ctx, images: mdImages(mode), video: mdVideo(mode), logs: mdLogs },
        { platform: "github" },
      ),
  },
  {
    name: "buildMarkdownIssueBody(gitlab)",
    run: (ctx, mode) =>
      buildMarkdownIssueBody(
        { ctx, images: mdImages(mode), video: mdVideo(mode), logs: mdLogs },
        { platform: "gitlab" },
      ),
  },
  { name: "buildIssueAdf", run: (ctx) => buildIssueAdf(ctx) },
  {
    name: "buildNotionIssueBody",
    run: (ctx, mode) =>
      buildNotionIssueBody({
        ctx,
        images: hasImage(mode)
          ? [
              {
                filename: "capture-0.webp",
                contentType: "image/webp",
                dataUrl: "data:image/webp;base64,AAAA",
              },
            ]
          : [],
        video: hasVideo(mode)
          ? {
              filename: "recording.mp4",
              contentType: "video/mp4",
              dataUrl: "data:video/mp4;base64,BBBB",
            }
          : undefined,
        logs: [
          {
            filename: "logs.html",
            contentType: "text/html",
            dataUrl: "data:text/html;base64,CCCC",
          },
        ],
      }),
  },
  {
    name: "buildAsanaIssueBody",
    run: (ctx, mode) =>
      buildAsanaIssueBody({
        ctx,
        images: hasImage(mode)
          ? [{ filename: "capture-0.webp", contentType: "image/webp" }]
          : [],
      }),
  },
  {
    name: "buildClickupIssueBody",
    run: (ctx, mode) =>
      buildClickupIssueBody({
        ctx,
        images: mdImages(mode),
        video: mdVideo(mode),
        logs: mdLogs,
      }),
  },
  {
    name: "buildLinearIssueBody",
    run: (ctx, mode) =>
      buildLinearIssueBody({
        ctx,
        images: hasImage(mode)
          ? [{ filename: "capture-0.webp", assetUrl: "https://cdn.test/c0.webp" }]
          : [],
        video: hasVideo(mode)
          ? { filename: "recording.mp4", assetUrl: "https://cdn.test/r.mp4" }
          : undefined,
      }),
  },
  { name: "buildSlackBody", run: (ctx) => buildSlackBody({ ctx }) },
];

describe("본문 출력 골든 — 기본 순서", () => {
  for (const { name, run } of OUTPUTS) {
    describe(name, () => {
      for (const mode of MODES) {
        it(`${mode} 모드 + 전체 로그`, () => {
          expect(run(makeCtx({ captureMode: mode }), mode)).toMatchSnapshot();
        });
      }
    });
  }
});

// 이 기능의 본질(사용자 재정렬)이 8빌더 전체에 걸려 있는지 봉인한다 — 기본 순서만 보면
// "media를 앞으로 옮겼는데 어느 빌더만 안 따라온" 회귀를 못 잡는다.
describe("본문 출력 골든 — media를 맨 앞으로 재정렬", () => {
  const reordered = [
    DEFAULT_ISSUE_SECTIONS.find((s) => s.id === "media")!,
    ...DEFAULT_ISSUE_SECTIONS.filter((s) => s.id !== "media"),
  ];
  for (const { name, run } of OUTPUTS) {
    it(`${name} — 미디어·로그가 본문 선두`, () => {
      const ctx = makeCtx({ captureMode: "screenshot", sectionConfig: reordered });
      expect(run(ctx, "screenshot")).toMatchSnapshot();
    });
  }
});

// 섹션 on/off 조합에서도 블록 순서·콘텐츠가 유지되는지.
describe("본문 출력 골든 — 섹션 enabled 변주", () => {
  const VARIANTS: { name: string; ctx: MarkdownContext }[] = [
    {
      name: "로그 없음(net/con/act 전부 부재)",
      ctx: makeCtx({
        networkLogSummary: undefined,
        consoleLogSummary: undefined,
        actionLogCaptured: undefined,
      }),
    },
    {
      // POSTMORTEM 2026-06-25 — video + 액션 로그만 있을 때 로그 요약이 통째로 스킵됐던 회귀.
      name: "video + 액션 로그만",
      ctx: makeCtx({
        captureMode: "video",
        networkLogSummary: undefined,
        consoleLogSummary: undefined,
        actionLogCaptured: 7,
      }),
    },
    { name: "notes까지 enabled", ctx: makeCtx({ sectionConfig: withEnabled({ notes: true }) }) },
    {
      name: "expectedResult 비활성 + notes 활성",
      ctx: makeCtx({ sectionConfig: withEnabled({ expectedResult: false, notes: true }) }),
    },
    {
      name: "미디어 뒤 섹션 전무(미디어가 말미)",
      ctx: makeCtx({ sectionConfig: withEnabled({ expectedResult: false, notes: false }) }),
    },
    {
      name: "재현과정 비활성",
      ctx: makeCtx({ sectionConfig: withEnabled({ stepsToReproduce: false }) }),
    },
  ];

  for (const { name, ctx } of VARIANTS) {
    it(`buildIssueMarkdown — ${name}`, () => {
      expect(buildIssueMarkdown(ctx)).toMatchSnapshot();
    });
    it(`buildIssueAdf — ${name}`, () => {
      expect(buildIssueAdf(ctx)).toMatchSnapshot();
    });
  }
});

describe("프리뷰 레이아웃 골든", () => {
  // 호출 어댑터만 리팩터에 맞춰 바뀐다(postMediaSectionIds 제거 → sectionIds에 media id 편입).
  // 기대 배열은 리팩터 전 기록 그대로여야 한다.
  const layout = (sectionIds: string[], hasMedia: boolean, hasLogCards: boolean) =>
    composePreviewLayout({ sectionIds, hasMedia, hasLogCards });

  it("기본 순서 — media/logCards가 기대결과 앞", () => {
    expect(
      layout(["description", "stepsToReproduce", "media", "expectedResult"], true, true),
    ).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "stepsToReproduce" },
      { kind: "media" },
      { kind: "logCards" },
      { kind: "section", id: "expectedResult" },
    ]);
  });

  it("post-media 섹션이 없으면 말미", () => {
    expect(layout(["description", "stepsToReproduce", "media"], true, true)).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "stepsToReproduce" },
      { kind: "media" },
      { kind: "logCards" },
    ]);
  });

  it("미디어 없으면 logCards만 삽입", () => {
    expect(layout(["description", "media", "expectedResult"], false, true)).toEqual([
      { kind: "section", id: "description" },
      { kind: "logCards" },
      { kind: "section", id: "expectedResult" },
    ]);
  });

  it("둘 다 없으면 섹션만", () => {
    expect(layout(["description", "expectedResult"], false, false)).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "expectedResult" },
    ]);
  });
});
