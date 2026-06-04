import { describe, expect, it, vi } from "vitest";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";

vi.stubGlobal("chrome", {
  runtime: { getManifest: () => ({ version: "1.0.0" }) },
});

vi.mock("../../../../dist-log-viewer/index.html?raw", () => ({
  default:
    '<!DOCTYPE html><html><head></head><body><script id="__BUGSHOT_DATA__" type="application/json"></script></body></html>',
}));

import { buildLogsHtml } from "../buildLogsHtml";

const networkLog: NetworkLog = {
  id: "net-1",
  startedAt: 1000,
  endedAt: 2000,
  totalSeen: 2,
  captured: 2,
  warnings: [],
  requests: [
    {
      id: "req-1",
      url: "https://example.com/api/data",
      method: "GET",
      status: 200,
      statusText: "OK",
      startTime: 1000,
      durationMs: 50,
      requestHeaders: {},
      responseHeaders: { "content-type": "application/json" },
      pageUrl: "https://example.com",
      requestBodySize: 0,
      responseBodySize: 100,
      contentType: "application/json",
      phase: "complete" as const,
    },
  ],
};

const consoleLog: ConsoleLog = {
  id: "con-1",
  startedAt: 1000,
  endedAt: 2000,
  totalSeen: 1,
  captured: 1,
  entries: [
    {
      id: "entry-1",
      level: "error",
      timestamp: 1500,
      args: "Something failed",
      stack: "Error: Something failed\n  at foo.js:1",
      pageUrl: "https://example.com",
    },
  ],
};

const actionLog: ActionLog = {
  id: "act-1",
  startedAt: 1000,
  endedAt: 2000,
  totalSeen: 2,
  captured: 2,
  entries: [
    {
      id: "ae-1",
      kind: "click",
      timestamp: 1100,
      pageUrl: "https://example.com",
      target: "Submit 버튼",
      selector: "button#submit",
    },
    {
      id: "ae-2",
      kind: "input",
      timestamp: 1200,
      pageUrl: "https://example.com",
      fieldLabel: "Email",
      value: "a@b.com",
    },
  ],
};

function extractData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="__BUGSHOT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

describe("buildLogsHtml", () => {
  it("networkLog + consoleLog 모두 → 데이터 주입된 HTML 반환", () => {
    const html = buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com");

    expect(html).toContain("<!DOCTYPE html>");
    const data = extractData(html);
    expect(data.networkLog).not.toBeNull();
    expect(data.consoleLog).not.toBeNull();
    expect(data.har).not.toBeNull();
    expect(data.consoleLogJson).not.toBeNull();
    expect(data.meta).toEqual(
      expect.objectContaining({
        version: "1.0.0",
        pageUrl: "https://example.com",
      }),
    );
  });

  it("networkLog null → networkLog·har가 null", () => {
    const data = extractData(
      buildLogsHtml(null, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.networkLog).toBeNull();
    expect(data.har).toBeNull();
    expect(data.consoleLog).not.toBeNull();
    expect(data.consoleLogJson).not.toBeNull();
  });

  it("consoleLog null → consoleLog·consoleLogJson이 null", () => {
    const data = extractData(
      buildLogsHtml(networkLog, null, null, null, null, "https://example.com"),
    );
    expect(data.consoleLog).toBeNull();
    expect(data.consoleLogJson).toBeNull();
    expect(data.networkLog).not.toBeNull();
    expect(data.har).not.toBeNull();
  });

  it("actionLog 있음 → actionLog·actionLogJson not null", () => {
    const data = extractData(
      buildLogsHtml(null, null, actionLog, null, null, "https://example.com"),
    );
    expect(data.actionLog).not.toBeNull();
    expect(data.actionLogJson).not.toBeNull();
  });

  it("actionLog null → actionLog·actionLogJson이 null (network/console 대칭)", () => {
    const data = extractData(
      buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.actionLog).toBeNull();
    expect(data.actionLogJson).toBeNull();
  });

  it("응답 body에 </script> 포함 → HTML 파싱 깨지지 않음", () => {
    const logWithScript: NetworkLog = {
      ...networkLog,
      requests: [
        {
          ...networkLog.requests[0],
          responseBody: '<script>alert("xss")</script>',
        },
      ],
    };
    const html = buildLogsHtml(logWithScript, null, null, null, null, "https://example.com");
    const data = extractData(html);
    const req = (data.networkLog as NetworkLog).requests[0];
    expect(req.responseBody).toBe('<script>alert("xss")</script>');
  });

  it("action value에 </script> 포함 → HTML 파싱 깨지지 않음", () => {
    const logWithScript: ActionLog = {
      ...actionLog,
      entries: [
        { ...actionLog.entries[1], value: '</script><script>alert(1)</script>' },
      ],
    };
    const html = buildLogsHtml(null, null, logWithScript, null, null, "https://example.com");
    const data = extractData(html);
    const entry = (data.actionLog as ActionLog).entries[0];
    expect(entry.value).toBe('</script><script>alert(1)</script>');
  });

  it("video 인자 있음 → data.video not null", () => {
    const video = {
      dataUrl: "data:video/mp4;base64,FAKE",
      startedAt: 1000,
    };
    const data = extractData(
      buildLogsHtml(networkLog, consoleLog, null, video, null, "https://example.com"),
    );
    expect(data.video).toEqual(expect.objectContaining({ startedAt: 1000 }));
  });

  it("screenshot 인자 있음 → data.screenshot not null", () => {
    const data = extractData(
      buildLogsHtml(
        networkLog,
        consoleLog,
        null,
        null,
        { dataUrl: "data:image/webp;base64,SHOT" },
        "https://example.com",
      ),
    );
    expect(data.screenshot).toEqual({ dataUrl: "data:image/webp;base64,SHOT" });
    expect(data.video).toBeNull();
  });

  it("issueUrl 미지정 → meta.issueUrl 빈 자리(주입 marker)", () => {
    const data = extractData(
      buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect((data.meta as { issueUrl: string }).issueUrl).toBe("");
  });

  it("video=null → data.video null", () => {
    const data = extractData(
      buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.video).toBeNull();
  });

  it("meta.createdAt은 ISO 문자열", () => {
    const data = extractData(
      buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    const meta = data.meta as { createdAt: string };
    expect(() => new Date(meta.createdAt).toISOString()).not.toThrow();
  });
});
