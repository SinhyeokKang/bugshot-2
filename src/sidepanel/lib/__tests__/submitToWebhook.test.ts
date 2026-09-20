import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/store/settings-ui-store", () => ({
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (...args: unknown[]) => sendBg(...args) }));

import { submitToWebhook, type WebhookSubmitInput } from "../submitToWebhook";
import type { MarkdownContext } from "../buildIssueMarkdown";
import type { WebhookAuth, WebhookSubmitPayload } from "@/types/webhook";

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

const MULTIPART_AUTH: WebhookAuth = {
  url: "https://bugs.acme.io/intake",
  headers: [{ name: "Authorization", value: "Bearer t" }],
  format: "multipart",
};

const JSON_AUTH: WebhookAuth = {
  url: "https://discord.example/hook",
  headers: [],
  format: "json",
  template: '{"content":"**{{title}}**\\n{{url}}"}',
};

function input(overrides: Partial<WebhookSubmitInput> = {}): WebhookSubmitInput {
  return {
    ctx: makeCtx(),
    auth: MULTIPART_AUTH,
    images: [{ filename: "screenshot.webp", dataUrl: "data:image/webp;base64,AA" }],
    logs: [{ filename: "logs.html", dataUrl: "data:text/html;base64,BB" }],
    idempotencyKey: "draft-1:1700000000000",
    ...overrides,
  };
}

function sentMessage(n = 0) {
  return sendBg.mock.calls[n][0] as {
    type: string;
    payload?: WebhookSubmitPayload;
    files?: { part: string }[];
    body?: unknown;
  };
}

beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.7.40" }) } });
  sendBg.mockReset();
  sendBg.mockResolvedValue({ key: "BUG-41", url: "https://bugs.acme.io/b/41" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("submitToWebhook — multipart", () => {
  it("본문의 인라인 미디어가 cid:로 참조된다 — 네트워크 업로드가 0회다", async () => {
    await submitToWebhook(input());

    // 업로드 왕복이 없다. sendBg는 webhook.submit 한 번뿐이다.
    expect(sendBg).toHaveBeenCalledTimes(1);
    const msg = sentMessage();
    expect(msg.type).toBe("webhook.submit");
    expect(msg.payload?.body).toContain("cid:screenshot.webp");
  });

  it("본문의 cid: 참조와 실어 보내는 파일 파트가 양방향으로 대응한다", async () => {
    await submitToWebhook(input());

    const msg = sentMessage();
    const refs = [...(msg.payload?.body ?? "").matchAll(/cid:([^\s)"'\]]+)/g)].map((m) => m[1]);
    const parts = (msg.files ?? []).map((f) => f.part);
    for (const ref of refs) expect(parts).toContain(ref);
    for (const part of parts) expect(refs).toContain(part);
  });

  it("성공하면 key/url을 그대로 돌려준다 — 이슈 목록 행의 근거다", async () => {
    const r = await submitToWebhook(input());
    expect(r).toMatchObject({ recorded: true, key: "BUG-41", url: "https://bugs.acme.io/b/41" });
  });

  it("같은 멱등 키로 두 번 보내면 요청의 키도 같다", async () => {
    await submitToWebhook(input());
    await submitToWebhook(input());
    expect(sentMessage(0).payload?.bugshot.idempotencyKey).toBe(
      sentMessage(1).payload?.bugshot.idempotencyKey,
    );
  });

  it("contentType은 파일명이 아니라 dataUrl에서 온다 — 실제 파트의 타입과 같은 출처", async () => {
    // 확장자와 dataUrl이 어긋난 입력으로 출처를 고정한다. 파일명 추측을 쓰면 image/webp가 된다.
    await submitToWebhook(
      input({
        images: [{ filename: "screenshot.webp", dataUrl: "data:image/png;base64,AA" }],
        logs: [],
      }),
    );

    const media = sentMessage().payload?.media ?? [];
    expect(media.find((m) => m.part === "screenshot.webp")?.contentType).toBe("image/png");
  });

  it("첨부는 part가 고유명, filename이 원본명이다 — 수신 서버 UI에 접두사가 안 뜬다", async () => {
    await submitToWebhook(
      input({
        attachments: [
          { filename: "a1__note.pdf", dataUrl: "data:application/pdf;base64,DD", displayName: "note.pdf" },
        ],
      }),
    );

    const att = (sentMessage().payload?.media ?? []).find((m) => m.kind === "attachment");
    expect(att?.part).toBe("a1__note.pdf");
    expect(att?.filename).toBe("note.pdf");
    expect(att?.contentType).toBe("application/pdf");
  });

  it("사용자 헤더는 payload가 아니라 auth로만 나간다", async () => {
    await submitToWebhook(input());
    expect(JSON.stringify(sentMessage().payload)).not.toContain("Bearer");
  });
});

describe("submitToWebhook — 인라인 이미지", () => {
  const inlineImages = [
    { refId: "abc123", dataUrl: "data:image/webp;base64,CC" },
  ];

  it("multipart: 본문이 참조하는 인라인 파트가 실제로 실린다 (고아 참조 0)", async () => {
    await submitToWebhook(
      input({
        inlineImages,
        ctx: makeCtx({ sections: { description: "앞 ![](inline:abc123) 뒤" } }),
      }),
    );

    const msg = sentMessage();
    const refs = [...(msg.payload?.body ?? "").matchAll(/cid:([^\s)"'\]]+)/g)].map((m) => m[1]);
    const parts = (msg.files ?? []).map((f) => f.part);
    expect(refs.some((r) => r.includes("abc123"))).toBe(true);
    for (const ref of refs) expect(parts).toContain(ref);
  });

  it("multipart: 인라인 파트가 payload.media에도 kind=inline으로 실린다", async () => {
    await submitToWebhook(
      input({
        inlineImages,
        ctx: makeCtx({ sections: { description: "![](inline:abc123)" } }),
      }),
    );

    const media = sentMessage().payload?.media ?? [];
    const entry = media.find((m) => m.kind === "inline");
    expect(entry).toBeDefined();
    expect((sentMessage().files ?? []).map((f) => f.part)).toContain(entry?.part);
  });

  it("json: {{sections.*}}로 직접 참조해도 내부 마커가 안 나간다", async () => {
    sendBg.mockResolvedValue({});
    await submitToWebhook(
      input({
        auth: { ...JSON_AUTH, template: '{"content":"{{sections.description}}"}' },
        inlineImages,
        ctx: makeCtx({ sections: { description: "앞 ![](inline:abc123) 뒤" } }),
      }),
    );

    const content = (sentMessage().body as { content: string }).content;
    expect(content).not.toContain("inline:abc123");
    expect(content).toContain("webhook.attachmentNotInline");
  });

  it("json: 내부 마커를 그대로 내보내지 않는다 — 흔적을 남기고 지운다", async () => {
    sendBg.mockResolvedValue({});
    await submitToWebhook(
      input({
        auth: { ...JSON_AUTH, template: '{"content":"{{body}}"}' },
        inlineImages,
        ctx: makeCtx({ sections: { description: "앞 ![](inline:abc123) 뒤" } }),
      }),
    );

    const body = (sentMessage().body as { content: string }).content;
    expect(body).not.toContain("inline:abc123");
    expect(body).toContain("webhook.attachmentNotInline");
  });
});

describe("submitToWebhook — json 템플릿", () => {
  it("{{media.N.contentType}}이 multipart payload와 같은 출처를 쓴다", async () => {
    sendBg.mockResolvedValue({});
    await submitToWebhook(
      input({
        auth: { ...JSON_AUTH, template: '{"c":"{{media.0.contentType}}"}' },
        images: [],
        logs: [],
        attachments: [
          { filename: "a1__note.pdf", dataUrl: "data:application/pdf;base64,DD", displayName: "note.pdf" },
        ],
      }),
    );

    // guessUploadMime은 pdf를 몰라 octet-stream을 준다 — 두 모드가 갈리면 안 된다.
    expect((sentMessage().body as { c: string }).c).toBe("application/pdf");
  });

  it("템플릿 렌더 결과를 바디로 보내고 미디어를 싣지 않는다", async () => {
    sendBg.mockResolvedValue({});
    await submitToWebhook(input({ auth: JSON_AUTH }));

    const msg = sentMessage();
    expect(msg.payload).toBeUndefined();
    expect(msg.files).toBeUndefined();
    expect(msg.body).toEqual({ content: "**버튼이 안 눌린다**\nhttps://example.com" });
  });

  it("성공해도 이슈 목록 행의 근거를 만들지 않는다 — recorded:false에 key도 url도 없다", async () => {
    sendBg.mockResolvedValue({});
    const r = await submitToWebhook(input({ auth: JSON_AUTH }));
    expect(r.recorded).toBe(false);
    expect(r.key).toBeUndefined();
    expect(r.url).toBeUndefined();
  });

  it("템플릿이 없으면 제출 전에 실패한다", async () => {
    await expect(
      submitToWebhook(input({ auth: { ...JSON_AUTH, template: undefined } })),
    ).rejects.toThrow();
    expect(sendBg).not.toHaveBeenCalled();
  });
});

describe("submitToWebhook — 실패 시 원본 보존", () => {
  it("background가 실패를 던지면 그대로 전파한다 — 호출부가 markSubmitted에 도달하지 못한다", async () => {
    sendBg.mockRejectedValue(new Error("boom"));
    await expect(submitToWebhook(input())).rejects.toThrow("boom");
  });
});

describe("submitToWebhook — 계약 방어", () => {
  it("background 가드가 사라져 key·url 없는 응답이 와도 행을 만들지 않는다", async () => {
    sendBg.mockResolvedValue({ key: "K" });
    await expect(submitToWebhook(input())).rejects.toThrow();
  });
});

describe("submitToWebhook — 본문 언어", () => {
  it("본문을 사이드패널에서 완결해 보낸다 — background 재래핑 인자를 싣지 않는다", async () => {
    await submitToWebhook(input({ ctx: makeCtx({ bodyLocale: "en" }) }));
    expect(sentMessage()).not.toHaveProperty("bodyLocale");
  });
});
