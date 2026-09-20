import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  withLocale: <T,>(_locale: string, fn: () => T): T => fn(),
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

import { buildWebhookPayload } from "../webhookPayload";
import { buildMarkdownIssueBody } from "../buildMarkdownIssueBody";
import type { CaptureFiles } from "../buildCaptureFiles";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    bodyLocale: "ko",
    captureMode: "screenshot",
    title: "버튼이 안 눌린다",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "media", enabled: true, renderAs: "meta", builtIn: true },
    ],
    url: "https://example.com",
    selector: "#pay",
    tagName: "button",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1024, height: 768 },
    capturedAt: 1700000000000,
    diffs: [],
    environment: [],
    ...overrides,
  };
}

function makeFiles(overrides: Partial<CaptureFiles> = {}): CaptureFiles {
  return {
    images: [{ filename: "screenshot.webp", dataUrl: "data:image/webp;base64,AA" }],
    logs: [{ filename: "logs.html", dataUrl: "data:text/html;base64,BB" }],
    attachments: [],
    ...overrides,
  };
}

const BASE = {
  idempotencyKey: "draft-1:1700000000000",
  sentAt: 1700000000000,
  version: "1.7.40",
};

function cidRefs(body: string): string[] {
  return [...body.matchAll(/cid:([^\s)"'\]]+)/g)].map((m) => m[1]);
}

describe("buildWebhookPayload — cid: 참조와 파트 이름의 양방향 대응", () => {
  it("본문의 모든 cid: 참조에 대응하는 media[].part가 있다 (고아 참조 0)", () => {
    const body = "![shot](cid:screenshot.webp)\n\n[logs](cid:logs.html)";
    const p = buildWebhookPayload({ ctx: makeCtx(), body, files: makeFiles(), ...BASE });
    const parts = new Set(p.media.map((m) => m.part));
    for (const ref of cidRefs(body)) expect(parts).toContain(ref);
  });

  it("역방향도 성립한다 — 본문이 참조하지 않는 파트가 없다", () => {
    const body = "![shot](cid:screenshot.webp)\n\n[logs](cid:logs.html)";
    const p = buildWebhookPayload({ ctx: makeCtx(), body, files: makeFiles(), ...BASE });
    const refs = new Set(cidRefs(body));
    for (const m of p.media) expect(refs).toContain(m.part);
  });

  it("영상·첨부까지 섞여도 양방향 대응이 유지된다", () => {
    const files = makeFiles({
      video: { filename: "replay.mp4", dataUrl: "data:video/mp4;base64,CC" },
      attachments: [
        { filename: "a1__note.pdf", dataUrl: "data:application/pdf;base64,DD", displayName: "note.pdf" },
      ],
    });
    const body = [
      "![shot](cid:screenshot.webp)",
      "[replay](cid:replay.mp4)",
      "[logs](cid:logs.html)",
      "[note.pdf](cid:a1__note.pdf)",
    ].join("\n\n");
    const p = buildWebhookPayload({ ctx: makeCtx(), body, files, ...BASE });
    expect(new Set(p.media.map((m) => m.part))).toEqual(new Set(cidRefs(body)));
  });

  it("첨부의 filename은 원본명, part는 고유화된 이름이다", () => {
    const files = makeFiles({
      attachments: [
        { filename: "a1__note.pdf", dataUrl: "data:application/pdf;base64,DD", displayName: "note.pdf" },
      ],
    });
    const body = "![shot](cid:screenshot.webp)\n[logs](cid:logs.html)\n[note.pdf](cid:a1__note.pdf)";
    const p = buildWebhookPayload({ ctx: makeCtx(), body, files, ...BASE });
    const att = p.media.find((m) => m.kind === "attachment");
    expect(att?.part).toBe("a1__note.pdf");
    expect(att?.filename).toBe("note.pdf");
  });

  it("kind로 미디어 종류를 구분한다", () => {
    const files = makeFiles({ video: { filename: "replay.mp4", dataUrl: "data:video/mp4;base64,CC" } });
    const body = "![shot](cid:screenshot.webp)\n[replay](cid:replay.mp4)\n[logs](cid:logs.html)";
    const p = buildWebhookPayload({ ctx: makeCtx(), body, files, ...BASE });
    expect(p.media.find((m) => m.part === "screenshot.webp")?.kind).toBe("image");
    expect(p.media.find((m) => m.part === "replay.mp4")?.kind).toBe("video");
    expect(p.media.find((m) => m.part === "logs.html")?.kind).toBe("logs");
  });
});

describe("buildWebhookPayload — 본문 외 필드", () => {
  // 계약 문서 §2.2가 environment의 예시로 OS·Browser를 든다. 파생 행은 본문 마크다운에만
  // 있고 payload엔 커스텀 행만 실려, 수신 서버는 마크다운을 파싱하지 않는 한 환경을 못 받았다.
  it("본문 재현 환경의 파생 행이 그대로 실린다 (OS·Browser·Page·DOM·Viewport·Captured)", () => {
    const ctx = makeCtx({ os: "macOS 15.2", browser: "Chrome 140" });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.environment.map((r) => r.label)).toEqual([
      "OS",
      "Browser",
      "Page",
      "DOM",
      "Viewport",
      "Captured",
    ]);
    const byLabel = Object.fromEntries(p.environment.map((r) => [r.label, r.value]));
    expect(byLabel.OS).toBe("macOS 15.2");
    expect(byLabel.Browser).toBe("Chrome 140");
    expect(byLabel.Page).toBe("https://example.com");
    expect(byLabel.DOM).toBe("#pay");
    expect(byLabel.Viewport).toBe("1024×768");
    expect(byLabel.Captured).toBeTruthy();
  });

  // **webhook 본문이 실제로 타는 빌더와 대조한다** — buildIssueMarkdown(복사·logs.html 전용)과
  // 대조하면 제출 경로의 복제본만 갈려도 green이다(자체 검증이 잡은 공허한 그물 형태).
  it("제출 본문의 재현 환경 섹션과 payload.environment의 행 집합이 일치한다", () => {
    const ctx = makeCtx({
      os: "macOS 15.2",
      browser: "Chrome 140",
      environment: [{ label: "API Hosts", value: "api.acme.io", source: "api-hosts" }],
    });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    // 제출 본문은 재현 환경 섹션으로 시작한다.
    const envSection = buildMarkdownIssueBody({ ctx }, { platform: "webhook" }).body.split("\n## ")[0];
    for (const row of p.environment) {
      // 본문의 DOM 행만 selector를 인라인 코드로 감싼다 — 값 자체는 같다.
      const value = row.label === "DOM" ? `\`${row.value}\`` : row.value;
      expect(envSection).toContain(`- **${row.label}**: ${value}`);
    }
  });

  // buildEditorCapture가 비-element 폴백으로 viewport {0,0}·capturedAt 0을 만든다. logs.html
  // 파생(buildReportData)은 그걸 가드해 행을 빼는데 본문·payload만 `0×0`·1970을 실었다.
  it("viewport 0×0과 capturedAt 0은 행을 만들지 않는다", () => {
    const ctx = makeCtx({ viewport: { width: 0, height: 0 }, capturedAt: 0 });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    const labels = p.environment.map((r) => r.label);
    expect(labels).not.toContain("Viewport");
    expect(labels).not.toContain("Captured");
  });

  it("파생 행 뒤에 커스텀 행이 filterEnvironmentRows를 거쳐 붙는다", () => {
    const ctx = makeCtx({
      viewport: null,
      selector: "",
      environment: [
        { label: "  Note  ", value: " 메모 " },
        { label: "", value: "버려짐" },
        { label: "Empty", value: "" },
        { label: "Multi", value: "a\nb" },
        { label: "API Hosts", value: "api.acme.io", source: "api-hosts" },
      ],
    });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.environment.slice(-3)).toEqual([
      { label: "Note", value: "메모" },
      { label: "Multi", value: "a b" },
      { label: "API Hosts", value: "api.acme.io" },
    ]);
  });

  it("source 같은 내부 메타데이터는 벗겨진다", () => {
    const ctx = makeCtx({
      environment: [{ label: "API Hosts", value: "api.acme.io", source: "api-hosts" }],
    });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.environment[0]).not.toHaveProperty("source");
  });

  it("액션 로그만 있어도 logSummary가 실린다 (POSTMORTEM 2026-06-25 회귀)", () => {
    const ctx = makeCtx({ actionLogCaptured: 12 });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.logSummary).toBe("action 12");
  });

  // 수신 서버가 파싱할 필드다. 마크다운 블록을 실으면 "첨부 파일을 보라"는 문장이 따라붙는데,
  // json 템플릿 모드는 파일을 아예 안 보내 그 문장이 거짓이 된다.
  it("logSummary는 개행 없는 한 줄 카운트 요약이다", () => {
    const ctx = makeCtx({
      consoleLogSummary: { captured: 3, errorCount: 1, warnCount: 0, topErrors: [] },
      networkLogSummary: { captured: 1, errorCount: 1, errors: [] },
      actionLogCaptured: 12,
    });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.logSummary).toBe("console 3 · network 1 · action 12");
  });

  it("logSummary는 보내지 않을 수도 있는 파일을 가리키지 않는다", () => {
    const ctx = makeCtx({ actionLogCaptured: 12, consoleLogSummary: { captured: 3, errorCount: 0, warnCount: 0, topErrors: [] } });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.logSummary).not.toContain("logs.html");
    expect(p.logSummary).not.toContain("\n");
  });

  it("로그가 하나도 없으면 logSummary를 싣지 않는다", () => {
    const p = buildWebhookPayload({
      ctx: makeCtx(),
      body: "",
      files: { images: [], logs: [], attachments: [] },
      ...BASE,
    });
    expect(p.logSummary).toBeUndefined();
  });

  it("title과 body를 그대로 싣는다", () => {
    const p = buildWebhookPayload({
      ctx: makeCtx(),
      body: "본문 원문",
      files: { images: [], logs: [], attachments: [] },
      ...BASE,
    });
    expect(p.title).toBe("버튼이 안 눌린다");
    expect(p.body).toBe("본문 원문");
  });

  it("bugshot 블록에 멱등 키가 실린다 — 타임아웃 후 재시도가 중복을 만들지 않게 하는 계약", () => {
    const p = buildWebhookPayload({
      ctx: makeCtx(),
      body: "",
      files: { images: [], logs: [], attachments: [] },
      ...BASE,
    });
    expect(p.bugshot.idempotencyKey).toBe("draft-1:1700000000000");
    expect(p.bugshot.sentAt).toBe(1700000000000);
    expect(p.bugshot.version).toBe("1.7.40");
  });

  it("사용자 헤더는 payload 어디에도 실리지 않는다 (불변식)", () => {
    const p = buildWebhookPayload({
      ctx: makeCtx(),
      body: "",
      files: { images: [], logs: [], attachments: [] },
      ...BASE,
    });
    expect(JSON.stringify(p)).not.toMatch(/authorization|bearer|headers/i);
  });
});
