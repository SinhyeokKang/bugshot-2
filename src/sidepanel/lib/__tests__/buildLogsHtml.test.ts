import { describe, expect, it, vi } from "vitest";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";

vi.stubGlobal("chrome", {
  runtime: { getManifest: () => ({ version: "1.0.0" }) },
});

vi.mock("../../../../dist-log-viewer/index.html?raw", () => ({
  default:
    '<!DOCTYPE html><html><head></head><body><script id="__BUGSHOT_DATA__" type="application/gzip-base64"></script><script id="__BUGSHOT_META__" type="application/json"></script></body></html>',
}));

import { buildLogsHtml } from "../buildLogsHtml";
import { base64ToGunzip } from "@/lib/gzip-base64";

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

function metaTag(html: string): string {
  const m = html.match(
    /<script id="__BUGSHOT_META__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  expect(m).not.toBeNull();
  return m![1];
}

// 무거운 데이터는 gzip-base64 DATA 태그, meta는 평문 META 태그 → 합쳐서 LogViewerData 복원.
async function extractData(html: string): Promise<Record<string, unknown>> {
  const dm = html.match(
    /<script id="__BUGSHOT_DATA__" type="application\/gzip-base64">([\s\S]*?)<\/script>/,
  );
  expect(dm).not.toBeNull();
  const heavy = JSON.parse(await base64ToGunzip(dm![1]));
  const meta = JSON.parse(metaTag(html));
  return { ...heavy, meta };
}

describe("buildLogsHtml", () => {
  it("networkLog + consoleLog 모두 → 데이터 주입된 HTML 반환", async () => {
    const html = await buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com");

    expect(html).toContain("<!DOCTYPE html>");
    const data = await extractData(html);
    expect(data.networkLog).not.toBeNull();
    expect(data.consoleLog).not.toBeNull();
    expect(data.meta).toEqual(
      expect.objectContaining({
        version: "1.0.0",
        pageUrl: "https://example.com",
      }),
    );
  });

  it("har/consoleLogJson/actionLogJson 파생 export는 payload에 직렬화하지 않는다 (즉석 생성)", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, actionLog, null, null, "https://example.com"),
    );
    // raw 로그는 보존, 파생 export 포맷은 제거(용량 중복 방지 — log-viewer가 다운로드 시 생성)
    expect(data.networkLog).not.toBeNull();
    expect(data.consoleLog).not.toBeNull();
    expect(data.actionLog).not.toBeNull();
    expect("har" in data).toBe(false);
    expect("consoleLogJson" in data).toBe(false);
    expect("actionLogJson" in data).toBe(false);
  });

  it("networkLog null → networkLog null", async () => {
    const data = await extractData(
      await buildLogsHtml(null, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.networkLog).toBeNull();
    expect(data.consoleLog).not.toBeNull();
  });

  it("consoleLog null → consoleLog null", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, null, null, null, null, "https://example.com"),
    );
    expect(data.consoleLog).toBeNull();
    expect(data.networkLog).not.toBeNull();
  });

  it("actionLog 있음 → actionLog not null", async () => {
    const data = await extractData(
      await buildLogsHtml(null, null, actionLog, null, null, "https://example.com"),
    );
    expect(data.actionLog).not.toBeNull();
  });

  it("actionLog null → actionLog null (network/console 대칭)", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.actionLog).toBeNull();
  });

  it("응답 body에 </script> 포함 → 압축 round-trip으로 보존", async () => {
    const logWithScript: NetworkLog = {
      ...networkLog,
      requests: [
        {
          ...networkLog.requests[0],
          responseBody: '<script>alert("xss")</script>',
        },
      ],
    };
    const html = await buildLogsHtml(logWithScript, null, null, null, null, "https://example.com");
    // 압축 blob이라 평문 </script>가 HTML에 노출되지 않음
    expect(html).not.toContain('<script>alert("xss")</script>');
    const data = await extractData(html);
    const req = (data.networkLog as NetworkLog).requests[0];
    expect(req.responseBody).toBe('<script>alert("xss")</script>');
  });

  it("action value에 </script> 포함 → 압축 round-trip으로 보존", async () => {
    const logWithScript: ActionLog = {
      ...actionLog,
      entries: [
        { ...actionLog.entries[1], value: '</script><script>alert(1)</script>' },
      ],
    };
    const html = await buildLogsHtml(null, null, logWithScript, null, null, "https://example.com");
    const data = await extractData(html);
    const entry = (data.actionLog as ActionLog).entries[0];
    expect(entry.value).toBe('</script><script>alert(1)</script>');
  });

  it("video 인자 있음 → data.video not null", async () => {
    const video = {
      dataUrl: "data:video/mp4;base64,FAKE",
      startedAt: 1000,
    };
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, null, video, null, "https://example.com"),
    );
    expect(data.video).toEqual(expect.objectContaining({ startedAt: 1000 }));
  });

  it("screenshot 인자 있음 → data.screenshot not null", async () => {
    const data = await extractData(
      await buildLogsHtml(
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

  it("issueUrl 미지정 → meta.issueUrl 빈 자리(주입 marker)", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect((data.meta as { issueUrl: string }).issueUrl).toBe("");
  });

  it("video=null → data.video null", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.video).toBeNull();
  });

  it("meta.createdAt은 ISO 문자열", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    const meta = data.meta as { createdAt: string };
    expect(() => new Date(meta.createdAt).toISOString()).not.toThrow();
  });

  it("report 미전달 → data.report null", async () => {
    const data = await extractData(
      await buildLogsHtml(networkLog, consoleLog, null, null, null, "https://example.com"),
    );
    expect(data.report).toBeNull();
  });

  it("report 전달 → data.report에 직렬화 포함", async () => {
    const report = {
      title: "리포트",
      env: [{ label: "OS", value: "macOS" }],
      sections: [{ id: "description", label: "발생 현상", renderAs: "paragraph" as const, value: "버그" }],
      copy: { markdown: "# 리포트", html: "<h1>리포트</h1>" },
    };
    const data = await extractData(
      await buildLogsHtml(networkLog, null, null, null, null, "https://example.com", undefined, undefined, report),
    );
    expect(data.report).toEqual(report);
  });

  it("issueUrl 마커는 평문 META 태그에만 — report(압축 blob)와 충돌 불가", async () => {
    // report 본문에 issueUrl 마커 리터럴을 심어도 압축 blob 안에 들어가 평문 노출 안 됨.
    const report = {
      title: "T",
      env: [],
      sections: [],
      copy: { markdown: 'evil "issueUrl":"" tail', html: "" },
    };
    const html = await buildLogsHtml(
      networkLog, null, null, null, null, "https://example.com", undefined, undefined, report,
    );

    // 평문 마커는 META 태그에 정확히 1번만 — injectIssueUrl의 lastIndexOf가 명확히 잡는다.
    expect(metaTag(html)).toContain('"issueUrl":""');
    expect(html.split('"issueUrl":""').length - 1).toBe(1);
    // report 본문 마커는 round-trip으로 보존(압축 blob 안)
    const data = await extractData(html);
    expect(((data.report as { copy: { markdown: string } }).copy.markdown)).toContain('"issueUrl":""');
  });
});
