import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

// 스레드 본문 빌더는 mock — MarkdownContext 처리는 buildSlackBody 자체 테스트의 몫.
let mockBody = "BODY";
vi.mock("../buildSlackBody", () => ({
  buildSlackBody: () => ({ body: mockBody, attached: [] }),
}));

import { submitToSlack } from "../submitToSlack";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(): MarkdownContext {
  return {
    captureMode: "screenshot",
    title: "Button broken",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com",
    selector: "div",
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1024, height: 768 },
    capturedAt: 1700000000000,
    diffs: [],
    environment: [],
  };
}

// 부모는 threadTs 없음(ts:111), 스레드 답글은 threadTs 있음(ts:222).
function defaultSendBg(msg: { type: string; payload?: { threadTs?: string } }) {
  if (msg.type === "slack.postMessage") {
    return msg.payload?.threadTs ? { ts: "222" } : { ts: "111" };
  }
  if (msg.type === "slack.getPermalink") {
    return { permalink: "https://slack.test/archives/C1/p111" };
  }
  if (msg.type === "slack.uploadFiles") return [];
  return undefined;
}

beforeEach(() => {
  mockBody = "BODY";
  sendBg.mockReset();
});

describe("submitToSlack — 전송 순서", () => {
  it("부모 메시지 → 스레드 답글 → 첨부 업로드 → permalink 순서로 호출", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "slack.uploadFiles"
        ? [{ filename: "screenshot.png", ok: true }]
        : defaultSendBg(msg as never),
    );

    const res = await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      images: [{ filename: "screenshot.png", dataUrl: "data:IMG" }],
    });

    const types = sendBg.mock.calls.map(([m]) => m.type);
    expect(types).toEqual([
      "slack.postMessage",
      "slack.postMessage",
      "slack.uploadFiles",
      "slack.getPermalink",
    ]);

    // 부모는 제목, 스레드는 BODY + threadTs=부모 ts.
    const parent = sendBg.mock.calls[0][0];
    expect(parent.payload.text).toContain("Button broken");
    expect(parent.payload.threadTs).toBeUndefined();
    const reply = sendBg.mock.calls[1][0];
    expect(reply.payload.text).toBe("BODY");
    expect(reply.payload.threadTs).toBe("111");

    // permalink는 부모 ts로 조회, 결과 url에 반영.
    const permalinkCall = sendBg.mock.calls.find(([m]) => m.type === "slack.getPermalink")![0];
    expect(permalinkCall.ts).toBe("111");
    expect(res).toEqual({
      key: "111",
      url: "https://slack.test/archives/C1/p111",
      logsDropped: false,
    });
  });
});

describe("submitToSlack — 멘션", () => {
  it("멘션 대상은 부모 메시지에 <@id>로 주입된다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      defaultSendBg(msg as never),
    );

    await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      mentions: [
        { id: "U1", name: "Alice" },
        { id: "U2", name: "Bob" },
      ],
    });

    const parentText = sendBg.mock.calls[0][0].payload.text;
    expect(parentText).toContain("<@U1>");
    expect(parentText).toContain("<@U2>");
  });
});

describe("submitToSlack — 첨부 없음", () => {
  it("파일 첨부가 0개면 uploadFiles를 건너뛴다 (부모+스레드+permalink만)", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      defaultSendBg(msg as never),
    );

    await submitToSlack({ ctx: makeCtx(), channelId: "C1" });

    expect(sendBg.mock.calls.map(([m]) => m.type)).toEqual([
      "slack.postMessage",
      "slack.postMessage",
      "slack.getPermalink",
    ]);
  });
});

describe("submitToSlack — logsDropped", () => {
  it("logs.html 업로드가 실패(ok:false)하면 logsDropped: true", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "slack.uploadFiles"
        ? [{ filename: "logs.html", ok: false }]
        : defaultSendBg(msg as never),
    );

    const res = await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(true);
  });
});

// 회귀: 4000자를 넘는 본문을 한 번에 보내면 Slack이 임의로 쪼개 코드블럭 펜스가 깨진다
// (로그가 평문으로 나오거나 엉뚱한 섹션이 코드블럭에 씌워짐 — 실사용 리포트).
describe("submitToSlack — 긴 본문 분할", () => {
  it("Slack 한계를 넘는 본문은 펜스를 유지한 채 여러 스레드 답글로 나간다", async () => {
    const huge = Array.from({ length: 400 }, (_, i) => `  "key${i}": ${i},`).join("\n");
    mockBody = ["*발생 현상*", "```json", huge, "```"].join("\n");
    sendBg.mockImplementation(defaultSendBg);

    await submitToSlack({ ctx: makeCtx(), channelId: "C1" });

    const posts = sendBg.mock.calls
      .map(([m]) => m)
      .filter((m) => m.type === "slack.postMessage" && m.payload?.threadTs);
    expect(posts.length).toBeGreaterThan(1);
    for (const p of posts) {
      expect(p.payload.text.length).toBeLessThanOrEqual(4000);
      // 조각마다 펜스가 짝수 = 코드블럭이 그 조각 안에서 열리고 닫힌다.
      expect((p.payload.text.match(/^ {0,3}```/gm) ?? []).length % 2).toBe(0);
      expect(p.payload.threadTs).toBe("111");
    }
  });
});

// 본문에 붙여넣은 인라인 이미지는 스레드 첨부로 함께 올라간다 (감사 🟡 항목).
describe("submitToSlack — 인라인 이미지", () => {
  it("inline-{refId}.webp 이름으로 업로드 목록에 넣는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "slack.uploadFiles"
        ? [{ filename: "inline-r1.webp", ok: true }]
        : defaultSendBg(msg as never),
    );

    await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);

    const upload = sendBg.mock.calls.find((c) => c[0].type === "slack.uploadFiles")![0];
    expect(upload.files).toEqual([{ filename: "inline-r1.webp", dataUrl: "data:IMG1" }]);
  });

  it("일반 첨부와 함께 보내면 이미지·로그 뒤에 인라인이 붙는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "slack.uploadFiles" ? [] : defaultSendBg(msg as never),
    );

    await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      images: [{ filename: "shot.png", dataUrl: "data:SHOT" }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);

    const upload = sendBg.mock.calls.find((c) => c[0].type === "slack.uploadFiles")![0];
    expect(upload.files.map((f: { filename: string }) => f.filename)).toEqual([
      "shot.png",
      "logs.html",
      "inline-r1.webp",
    ]);
  });

  // 인라인 이미지 업로드 실패는 logsDropped(로그 전용 신호)를 오염시키면 안 된다.
  it("인라인 업로드가 실패해도 logsDropped는 로그 기준으로만 판정한다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "slack.uploadFiles"
        ? [
            { filename: "logs.html", ok: true },
            { filename: "inline-r1.webp", ok: false },
          ]
        : defaultSendBg(msg as never),
    );

    const res = await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);

    expect(res.logsDropped).toBe(false);
  });

  it("인라인 이미지만 있고 다른 첨부가 없어도 업로드를 호출한다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "slack.uploadFiles" ? [] : defaultSendBg(msg as never),
    );

    await submitToSlack({
      ctx: makeCtx(),
      channelId: "C1",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);

    expect(sendBg.mock.calls.some((c) => c[0].type === "slack.uploadFiles")).toBe(true);
  });
});
