import { describe, it, expect, vi } from "vitest";

// 본문 출력 **엣지 축** 회귀망 — 골든(bodyOutputGolden)이 스냅샷으로 봉인한 건 "값이 다 채워진"
// 한 갈래뿐이라, 빈 재현과정·에러 0건 로그처럼 조건 분기의 반대편은 8빌더 어디에서도 실행되지 않았다.
// 여기서는 그 반대편만 본다. 스냅샷을 쓰지 않는 것도 의도다 — 기대값을 리터럴로 박아야
// "출력이 바뀌었다"가 아니라 "어느 분기를 탔다"를 단언할 수 있다.
//
// ── 사정거리 (POSTMORTEM 2026-08-14: 골든이 "생산자를 안 부르는 공허한 그물"로 판정된 항목의 재발 방지)
// 이 그물은 **소비자(빌더)까지**다. ctx 리터럴을 손으로 조립하고 t()를 목하므로
// "에러 0건 세션이 실제로 errorCount: 0을 만드는가"는 **안 본다** — 그 생산자 축은
// buildEditorCapture.test.ts의 "로그 에러 0건 세션" 짝 케이스가 맡는다. 둘 중 하나만 있으면
// 빌더는 lineNoError를 그릴 줄 알지만 아무도 그 입력을 만들지 않는(혹은 그 반대) 구멍이 남는다.

// 타임스탬프는 실행 머신 TZ·로케일에 의존한다(POSTMORTEM 2026-07-16 toLocaleString 함정).
vi.mock("../formatTimestamp", () => ({
  formatTimestamp: () => "2023-11-14 22:13:20 GMT+9",
}));

vi.mock("@/i18n", () => ({
  // 빌더 진입점이 withLocale로 감싸져 있다 — 모킹에서 빠지면 통째로 죽는다(패스스루).
  withLocale: <T>(_locale: string, fn: () => T): T => fn(),
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

import { DEFAULT_ISSUE_SECTIONS } from "@/store/settings-ui-store";
import {
  buildIssueMarkdown,
  buildIssueHtml,
  type MarkdownContext,
} from "../buildIssueMarkdown";
import { buildMarkdownIssueBody } from "../buildMarkdownIssueBody";
import { buildIssueAdf } from "../buildIssueAdf";
import { buildNotionIssueBody, type NotionBuildInput } from "../buildNotionIssueBody";
import { buildAsanaIssueBody } from "../buildAsanaIssueBody";
import { buildClickupIssueBody } from "../buildClickupIssueBody";
import { buildLinearIssueBody } from "../buildLinearIssueBody";
import { buildSlackBody } from "../buildSlackBody";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    bodyLocale: "ko",
    os: "macOS 15.5",
    browser: "Chrome 138",
    captureMode: "screenshot",
    title: "Edge Issue",
    sections: {
      description: "버튼이 눌리지 않음",
      stepsToReproduce: "1단계 진입\n2단계 클릭",
      expectedResult: "버튼이 눌린다",
    },
    sectionConfig: DEFAULT_ISSUE_SECTIONS,
    url: "https://example.com/page",
    selector: "div.container > button",
    tagName: "button",
    classListBefore: ["btn"],
    classListAfter: ["btn", "btn-primary"],
    specifiedStyles: { color: "#000" },
    tokens: [],
    viewport: { width: 1920, height: 1080 },
    capturedAt: 1700000000000,
    diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    environment: [{ label: "Locale", value: "ko-KR" }],
    networkLogSummary: { captured: 12, errorCount: 3, errors: [] },
    consoleLogSummary: { captured: 8, errorCount: 2, warnCount: 1, topErrors: [] },
    actionLogCaptured: 5,
    ...overrides,
  };
}

const mdImages = [
  { filename: "capture-0.webp", contentType: "image/webp", url: "https://cdn.test/c0.webp" },
];
const mdLogs = [
  { filename: "logs.html", contentType: "text/html", url: "https://cdn.test/logs.html" },
];

// listMarker는 각 빌더가 orderedList를 그릴 때 내는 **리터럴**이다. SUT에서 끌어오면
// 항진명제가 되므로 손으로 박는다(공통 규칙 2).
const OUTPUTS: {
  name: string;
  listMarker: string;
  run: (ctx: MarkdownContext) => unknown;
}[] = [
  { name: "buildIssueMarkdown", listMarker: "1. ", run: (ctx) => buildIssueMarkdown(ctx) },
  { name: "buildIssueHtml", listMarker: "<ol>", run: (ctx) => buildIssueHtml(ctx) },
  {
    name: "buildMarkdownIssueBody(github)",
    listMarker: "1. ",
    run: (ctx) =>
      buildMarkdownIssueBody(
        { ctx, images: mdImages, logs: mdLogs },
        { platform: "github" },
      ),
  },
  {
    name: "buildMarkdownIssueBody(gitlab)",
    listMarker: "1. ",
    run: (ctx) =>
      buildMarkdownIssueBody(
        { ctx, images: mdImages, logs: mdLogs },
        { platform: "gitlab" },
      ),
  },
  { name: "buildIssueAdf", listMarker: "orderedList", run: (ctx) => buildIssueAdf(ctx) },
  {
    name: "buildNotionIssueBody",
    listMarker: "numbered_list_item",
    run: (ctx) =>
      buildNotionIssueBody({
        ctx,
        images: [
          {
            filename: "capture-0.webp",
            contentType: "image/webp",
            dataUrl: "data:image/webp;base64,AAAA",
          },
        ],
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
    listMarker: "1. ",
    run: (ctx) =>
      buildAsanaIssueBody({
        ctx,
        images: [{ filename: "capture-0.webp", contentType: "image/webp" }],
      }),
  },
  {
    name: "buildClickupIssueBody",
    listMarker: "1. ",
    run: (ctx) =>
      buildClickupIssueBody({ ctx, images: mdImages, logs: mdLogs }),
  },
  {
    name: "buildLinearIssueBody",
    listMarker: "1. ",
    run: (ctx) =>
      buildLinearIssueBody({
        ctx,
        images: [{ filename: "capture-0.webp", assetUrl: "https://cdn.test/c0.webp" }],
      }),
  },
  { name: "buildSlackBody", listMarker: "1. ", run: (ctx) => buildSlackBody({ ctx }) },
];

const asText = (out: unknown): string =>
  typeof out === "string" ? out : JSON.stringify(out);

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/* ------------------------------------------------------------------ */
/*  축 A — 빈 orderedList                                              */
/* ------------------------------------------------------------------ */

// 재현 과정이 비면 8빌더 전부 `md.noValue` 한 줄로 떨어져야 한다. 항목 마커가 남으면
// 빈 번호 목록(`1. `)이 이슈 본문에 찍힌다.
describe("본문 출력 엣지 — 축 A: 빈 orderedList", () => {
  const EMPTY_STEPS = ["", "   ", "\n  \n\t\n"];

  for (const { name, listMarker, run } of OUTPUTS) {
    describe(name, () => {
      for (const steps of EMPTY_STEPS) {
        it(`stepsToReproduce=${JSON.stringify(steps)} → md.noValue 1회 · 항목 마커 없음`, () => {
          const ctx = makeCtx({
            sections: {
              description: "버튼이 눌리지 않음",
              stepsToReproduce: steps,
              expectedResult: "버튼이 눌린다",
            },
          });
          const s = asText(run(ctx));

          expect(countOf(s, "md.noValue")).toBe(1);
          expect(s).not.toContain(listMarker);
        });
      }

      // 대조군 — 마커 부재 단언이 항상 참이 되는 걸 막는다.
      it("stepsToReproduce가 있으면 마커가 나오고 md.noValue는 0회", () => {
        const s = asText(run(makeCtx()));

        expect(countOf(s, "md.noValue")).toBe(0);
        expect(s).toContain(listMarker);
      });
    });
  }
});

/* ------------------------------------------------------------------ */
/*  축 B — 로그 에러 0건                                                */
/* ------------------------------------------------------------------ */

// errorCount와 errors 둘 다 0이어야 한다 — 게이트가 `net.errorCount ?? net.errors.length`라
// errors만 비우면 errorCount 3이 그대로 살아 with-error 분기를 탄다(buildLogSummary.ts).
// 둘 다 0인 픽스처라 `??` 자체가 어느 쪽으로 무너져도 여기선 green이다 — 그 축은
// `buildLogSummary.test.ts`가 잠근다. 이 파일의 사정거리는 "0이면 lineNoError를 탄다"까지.
const NO_ERROR_LOGS = {
  networkLogSummary: { captured: 12, errorCount: 0, errors: [] },
  consoleLogSummary: { captured: 8, errorCount: 0, warnCount: 0, topErrors: [] },
  actionLogCaptured: 5,
} satisfies Partial<MarkdownContext>;

describe("본문 출력 엣지 — 축 B: 로그 에러 0건", () => {
  for (const { name, run } of OUTPUTS) {
    it(`${name} — network/console 모두 lineNoError`, () => {
      const s = asText(run(makeCtx(NO_ERROR_LOGS)));

      expect(s).toContain("logSummary.network.lineNoError n=12");
      expect(s).toContain("logSummary.console.lineNoError n=8");
      // 목 포맷 의존을 줄이려 두 축으로 본다: 키 자체와 params 문자열.
      expect(s).not.toMatch(/logSummary\.network\.line(?!NoError)/);
      expect(s).not.toMatch(/logSummary\.console\.line(?!NoError)/);
      expect(s).not.toContain("errors=");
      expect(s).not.toContain("warns=");
      // 액션 줄은 에러 축과 무관하게 남는다.
      expect(s).toContain("logSummary.action.line n=5");
    });
  }
});

/* ------------------------------------------------------------------ */
/*  축 B-2 — errors=0 & warns>0                                        */
/* ------------------------------------------------------------------ */

// 조건 `con.errorCount > 0 || con.warnCount > 0`이 5벌 문자 그대로 복제돼 있다
// (issueBodyShared · buildSlackBody · buildIssueAdf · buildNotionIssueBody · buildIssueMarkdown).
// 이 케이스가 없으면 누가 `errorCount > 0`으로 "단순화"해도 전부 green이고 경고 건수가
// 조용히 본문에서 사라진다.
describe("본문 출력 엣지 — 축 B-2: 에러 0 · 경고 5", () => {
  const WARN_ONLY = {
    networkLogSummary: { captured: 12, errorCount: 0, errors: [] },
    consoleLogSummary: { captured: 8, errorCount: 0, warnCount: 5, topErrors: [] },
    actionLogCaptured: 5,
  } satisfies Partial<MarkdownContext>;

  for (const { name, run } of OUTPUTS) {
    it(`${name} — console은 line(경고 포함), network는 lineNoError`, () => {
      const s = asText(run(makeCtx(WARN_ONLY)));

      expect(s).toMatch(/logSummary\.console\.line(?!NoError)/);
      expect(s).not.toContain("logSummary.console.lineNoError");
      expect(s).toContain("errors=0");
      expect(s).toContain("warns=5");
      // network는 같은 픽스처에서 에러 0이므로 반대편을 탄다 — 두 게이트가 독립임을 고정.
      expect(s).toContain("logSummary.network.lineNoError n=12");
    });
  }
});

/* ------------------------------------------------------------------ */
/*  ClickUp — 스타일 표 스냅샷 행                                       */
/* ------------------------------------------------------------------ */

// before/after 이미지에 url이 붙어야만 나오는 행. 골든은 clickup에 capture-0.webp만 넘겨
// resolveStyleElements의 before-0/after-0과 이름이 어긋나 이 행을 한 번도 그리지 않았다.
describe("buildClickupIssueBody — 스타일 표 스냅샷 행", () => {
  const styleImages = [
    { filename: "before-0.webp", contentType: "image/webp", url: "https://cdn.test/b0.webp" },
    { filename: "after-0.webp", contentType: "image/webp", url: "https://cdn.test/a0.webp" },
  ];

  it("before/after url이 있으면 snapshot 행이 표 첫 줄에 온다", () => {
    const res = buildClickupIssueBody({
      ctx: makeCtx({ captureMode: "element" }),
      images: styleImages,
      logs: mdLogs,
    });

    expect(res.body).toContain(
      "| **styleTable.snapshot** | ![before-0.webp](https://cdn.test/b0.webp) | ![after-0.webp](https://cdn.test/a0.webp) |",
    );
    expect(res.attached).toContain("before-0.webp");
    expect(res.attached).toContain("after-0.webp");
  });

  it("url이 없으면 snapshot 행이 없다", () => {
    const res = buildClickupIssueBody({
      ctx: makeCtx({ captureMode: "element" }),
      images: [
        { filename: "before-0.webp", contentType: "image/webp" },
        { filename: "after-0.webp", contentType: "image/webp" },
      ],
      logs: mdLogs,
    });

    expect(res.body).not.toContain("styleTable.snapshot");
    expect(res.attached).not.toContain("before-0.webp");
  });
});

/* ------------------------------------------------------------------ */
/*  축 C — Notion 전용 잔여                                             */
/* ------------------------------------------------------------------ */

const notionLogs = [
  { filename: "logs.html", contentType: "text/html", dataUrl: "data:text/html;base64,CCCC" },
];

const notion = (input: Omit<NotionBuildInput, "ctx"> & { ctx?: MarkdownContext }) =>
  buildNotionIssueBody({ ctx: makeCtx({ captureMode: "video" }), logs: notionLogs, ...input });

describe("buildNotionIssueBody — video 첨부 categorize 3분기", () => {
  it("contentType이 image/*면 image 블록", () => {
    const res = notion({
      video: {
        filename: "clip.gif",
        contentType: "image/gif",
        dataUrl: "data:image/gif;base64,BBBB",
      },
    });

    expect(res.blocks).toContainEqual({ type: "image", placeholderId: "video-0" });
    expect(res.attachments[0]).toEqual({
      placeholderId: "video-0",
      filename: "clip.gif",
      contentType: "image/gif",
      dataUrl: "data:image/gif;base64,BBBB",
      category: "image",
    });
  });

  it("contentType이 video/*면 video 블록", () => {
    const res = notion({
      video: {
        filename: "recording.mp4",
        contentType: "video/mp4",
        dataUrl: "data:video/mp4;base64,BBBB",
      },
    });

    expect(res.blocks).toContainEqual({ type: "video", placeholderId: "video-0" });
    expect(res.attachments[0].category).toBe("video");
  });

  it("category가 명시된 other면 인라인 없이 안내 문단만", () => {
    const res = notion({
      video: {
        filename: "recording.mkv",
        contentType: "video/x-matroska",
        dataUrl: "data:application/octet-stream;base64,BBBB",
        category: "other",
      },
    });

    expect(res.blocks).toContainEqual({ type: "paragraph", text: "md.videoAttached" });
    expect(res.blocks).not.toContainEqual({ type: "video", placeholderId: "video-0" });
    expect(res.attachments[0].category).toBe("other");
  });

  it("video 모드인데 첨부가 없으면 안내 문단만 (첨부 0건)", () => {
    const res = notion({});

    expect(res.blocks).toContainEqual({ type: "paragraph", text: "md.videoAttached" });
    expect(res.attachments.map((a) => a.filename)).toEqual(["logs.html"]);
  });
});

describe("buildNotionIssueBody — userAttachments file block", () => {
  it("사용자 첨부는 인라인 없이 category other로 큐잉된다", () => {
    const res = buildNotionIssueBody({
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        {
          filename: "capture-0.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,AAAA",
        },
      ],
      logs: notionLogs,
      userAttachments: [
        {
          filename: "spec.pdf",
          contentType: "application/pdf",
          dataUrl: "data:application/pdf;base64,DDDD",
        },
        {
          filename: "extra.png",
          contentType: "image/png",
          dataUrl: "data:image/png;base64,EEEE",
        },
      ],
    });

    expect(res.attachments).toEqual([
      {
        placeholderId: "screenshot-0",
        filename: "capture-0.webp",
        contentType: "image/webp",
        dataUrl: "data:image/webp;base64,AAAA",
        category: "image",
      },
      {
        placeholderId: "log-1",
        filename: "logs.html",
        contentType: "text/html",
        dataUrl: "data:text/html;base64,CCCC",
        category: "log",
      },
      {
        placeholderId: "attachment-2",
        filename: "spec.pdf",
        contentType: "application/pdf",
        dataUrl: "data:application/pdf;base64,DDDD",
        category: "other",
      },
      {
        placeholderId: "attachment-3",
        filename: "extra.png",
        contentType: "image/png",
        dataUrl: "data:image/png;base64,EEEE",
        category: "other",
      },
    ]);
    // 인라인 이미지 블록으로 새지 않는다 — image/png인데도 category는 other다.
    expect(res.blocks).not.toContainEqual({ type: "image", placeholderId: "attachment-3" });
  });
});

// 나머지 7빌더는 빈 paragraph 섹션에 무조건 `(없음)`을 내지만 Notion만 예외다.
// 업로드된 인라인 이미지가 있으면 이미지가 곧 내용이므로 안 낸다 — **의도된 비대칭**이고,
// "일관성"을 이유로 여기 md.noValue를 되살리면 이미지 위에 (없음)이 겹쳐 찍힌다.
describe("buildNotionIssueBody — 인라인 이미지만 있는 paragraph 섹션 (의도된 md.noValue 비대칭)", () => {
  const withRef = (description: string) =>
    makeCtx({
      captureMode: "screenshot",
      sections: {
        description,
        stepsToReproduce: "1단계 진입",
        expectedResult: "버튼이 눌린다",
      },
    });

  it("업로드된 인라인 이미지만 있으면 md.noValue를 내지 않는다", () => {
    const res = buildNotionIssueBody({
      ctx: withRef("![](inline:abc)"),
      logs: notionLogs,
      inlineImageRefIds: ["abc"],
    });

    expect(res.blocks).toContainEqual({ type: "image", placeholderId: "inline-abc" });
    expect(res.blocks.some((b) => "text" in b && b.text === "md.noValue")).toBe(false);
  });

  // 업로드 실패·미업로드 참조는 이미지 블록도 md.noValue도 아니다 — 원문이 그대로
  // markdownToNotionBlocks를 타서 빈 rich_paragraph로 떨어진다(현행 동작 고정).
  it("업로드되지 않은 참조는 이미지 블록이 안 나오고 md.noValue도 안 난다", () => {
    const res = buildNotionIssueBody({
      ctx: withRef("![](inline:abc)"),
      logs: notionLogs,
      inlineImageRefIds: [],
    });

    expect(res.blocks).not.toContainEqual({ type: "image", placeholderId: "inline-abc" });
    expect(res.blocks.some((b) => "text" in b && b.text === "md.noValue")).toBe(false);
  });

  it("본문이 완전히 비면 md.noValue를 낸다", () => {
    const res = buildNotionIssueBody({
      ctx: withRef(""),
      logs: notionLogs,
      inlineImageRefIds: ["abc"],
    });

    expect(res.blocks).toContainEqual({ type: "paragraph", text: "md.noValue" });
  });
});
