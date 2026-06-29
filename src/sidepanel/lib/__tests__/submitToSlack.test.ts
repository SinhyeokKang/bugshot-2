import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

// 스레드 본문 빌더는 mock — MarkdownContext 처리는 buildSlackBody 자체 테스트의 몫.
vi.mock("../buildSlackBody", () => ({
  buildSlackBody: () => ({ body: "BODY", attached: [] }),
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
