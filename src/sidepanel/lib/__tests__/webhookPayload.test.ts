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
  it("environment가 filterEnvironmentRows를 거친 결과와 일치한다", () => {
    const ctx = makeCtx({
      environment: [
        { label: "  OS  ", value: " macOS " },
        { label: "", value: "버려짐" },
        { label: "Note", value: "" },
        { label: "Page", value: "a\nb" },
        { label: "API Hosts", value: "api.acme.io", source: "api-hosts" },
      ],
    });
    const p = buildWebhookPayload({ ctx, body: "", files: { images: [], logs: [], attachments: [] }, ...BASE });
    expect(p.environment).toEqual([
      { label: "OS", value: "macOS" },
      { label: "Page", value: "a b" },
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
    expect(p.logSummary).toBeTruthy();
    expect(p.logSummary).toContain("12");
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
