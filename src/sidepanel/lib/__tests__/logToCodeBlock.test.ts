import { describe, expect, it } from "vitest";
import { serializeConsoleEntry, serializeNetworkRequest } from "../logToCodeBlock";
import type { NetworkRequest, NetworkRequestBody } from "@/types/network";
import type { ConsoleEntry, ConsoleLevel } from "@/types/console";

function makeRequest(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "r1",
    url: "https://api.example.com/api/orders/123?q=1",
    method: "POST",
    status: 200,
    statusText: "OK",
    startTime: 1000,
    durationMs: 12,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://example.com/",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete",
    ...over,
  };
}

function makeEntry(over: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: "c1",
    level: "error" as ConsoleLevel,
    timestamp: 1000,
    args: "Uncaught TypeError: x is not a function",
    pageUrl: "https://example.com/",
    ...over,
  };
}

describe("serializeNetworkRequest", () => {
  it("JSON body는 정렬해서 payload·response 섹션으로 담고 language=json", () => {
    const { text, language } = serializeNetworkRequest(
      makeRequest({
        requestBody: '{"items":[1,2]}',
        responseBody: '{"result":"FAILED"}',
      }),
    );

    expect(text).toBe(
      [
        "POST /api/orders/123 → 200 OK",
        "--- payload ---",
        '{\n  "items": [\n    1,\n    2\n  ]\n}',
        "--- response ---",
        '{\n  "result": "FAILED"\n}',
      ].join("\n"),
    );
    expect(language).toBe("json");
  });

  it("JSON이 아닌 body는 raw 그대로 두고 language 없음", () => {
    const { text, language } = serializeNetworkRequest(
      makeRequest({ method: "GET", responseBody: "plain text response" }),
    );

    expect(text).toBe(
      ["GET /api/orders/123 → 200 OK", "--- response ---", "plain text response"].join("\n"),
    );
    expect(language).toBeUndefined();
  });

  it("body가 없으면 헤더 라인만", () => {
    const { text } = serializeNetworkRequest(makeRequest({ method: "GET" }));

    expect(text).toBe("GET /api/orders/123 → 200 OK");
  });

  it.each<[string, NetworkRequestBody, string]>([
    ["truncated", { kind: "truncated", limit: 1048576, size: 5242880 }, "[truncated 5.0 MB/1.0 MB]"],
    ["binary", { kind: "binary", contentType: "image/png", size: 2097152 }, "[binary image/png 2.0 MB]"],
    ["stream", { kind: "stream", contentType: "text/event-stream" }, "[stream text/event-stream]"],
    ["omitted", { kind: "omitted", reason: "memory-cap" }, "[omitted: memory-cap]"],
  ])("descriptor body(%s)는 라벨 한 줄로 대체", (_kind, body, label) => {
    const { text, language } = serializeNetworkRequest(makeRequest({ responseBody: body }));

    expect(text).toBe(["POST /api/orders/123 → 200 OK", "--- response ---", label].join("\n"));
    expect(language).toBeUndefined();
  });

  it("16384자를 넘는 body는 자르고 …(truncated) 표시", () => {
    const huge = "x".repeat(20000);
    const { text } = serializeNetworkRequest(makeRequest({ responseBody: huge }));

    expect(text).toBe(
      ["POST /api/orders/123 → 200 OK", "--- response ---", `${"x".repeat(16384)}…(truncated)`].join(
        "\n",
      ),
    );
  });

  it("정확히 16384자인 body는 자르지 않는다", () => {
    const exact = "x".repeat(16384);
    const { text } = serializeNetworkRequest(makeRequest({ responseBody: exact }));

    expect(text.endsWith("…(truncated)")).toBe(false);
    expect(text).toContain(exact);
  });

  it("빈 문자열 body는 섹션을 만들지 않는다", () => {
    const { text } = serializeNetworkRequest(makeRequest({ requestBody: "", responseBody: "" }));

    expect(text).toBe("POST /api/orders/123 → 200 OK");
  });

  it("raw body의 라인 시작 백틱 런은 fence를 깨지 않게 무해화한다", () => {
    const { text } = serializeNetworkRequest(
      makeRequest({ responseBody: "before\n```\nrest\n```json\nend" }),
    );

    // tiptap-markdown이 코드블럭을 3백틱으로 감싸므로, 들여쓰기 0~3의 백틱 런은 fence를 조기 종료시킨다.
    expect(text).not.toMatch(/^ {0,3}`{3,}/m);
    expect(text).toContain("before");
    expect(text).toContain("rest");
    expect(text).toContain("end");
  });

  it("pending 요청은 status 대신 (pending)", () => {
    const { text } = serializeNetworkRequest(
      makeRequest({ phase: "pending", status: 0, statusText: "" }),
    );

    expect(text).toBe("POST /api/orders/123 → (pending)");
  });

  it("status 0인 완료 요청은 status 표기를 생략", () => {
    const { text } = serializeNetworkRequest(
      makeRequest({ phase: "error", status: 0, statusText: "" }),
    );

    expect(text).toBe("POST /api/orders/123");
  });

  it("statusText가 비면 status만 표기", () => {
    const { text } = serializeNetworkRequest(makeRequest({ status: 204, statusText: "" }));

    expect(text).toBe("POST /api/orders/123 → 204");
  });

  // statusSuffix를 HTTP와 공유 — statusText까지 붙어 "→ 101 Switching Protocols"가 된다.
  it("WebSocket은 헤더 라인만 (body 섹션 없음), path는 HTTP와 같게 pathname만", () => {
    const { text, language } = serializeNetworkRequest(
      makeRequest({
        url: "wss://api.example.com/socket?sid=secret",
        method: "WS",
        status: 101,
        statusText: "Switching Protocols",
        requestBody: '{"a":1}',
        responseBody: '{"b":2}',
        webSocket: { protocol: "", frames: [], framesTotal: 0 },
      }),
    );

    expect(text).toBe("WS /socket → 101 Switching Protocols");
    expect(language).toBeUndefined();
  });

  it("pending WebSocket도 status 방어를 공유한다", () => {
    const { text } = serializeNetworkRequest(
      makeRequest({
        url: "wss://api.example.com/socket",
        method: "WS",
        status: 0,
        statusText: "",
        phase: "pending",
        webSocket: { protocol: "", frames: [], framesTotal: 0 },
      }),
    );

    expect(text).toBe("WS /socket → (pending)");
  });

  it("payload만 JSON이고 response가 raw여도 language는 json", () => {
    const { language } = serializeNetworkRequest(
      makeRequest({ requestBody: '{"a":1}', responseBody: "plain" }),
    );

    expect(language).toBe("json");
  });

  it("URL 파싱에 실패하면 원본 url을 경로로 사용", () => {
    const { text } = serializeNetworkRequest(makeRequest({ method: "GET", url: "not-a-url" }));

    expect(text).toBe("GET not-a-url → 200 OK");
  });
});

describe("serializeConsoleEntry", () => {
  it("error는 [level] args 다음 줄에 stack", () => {
    const { text, language } = serializeConsoleEntry(
      makeEntry({ stack: "  at foo (app.js:12:3)\n  at bar (app.js:34:5)" }),
    );

    expect(text).toBe(
      [
        "[error] Uncaught TypeError: x is not a function",
        "  at foo (app.js:12:3)",
        "  at bar (app.js:34:5)",
      ].join("\n"),
    );
    expect(language).toBeUndefined();
  });

  it("stack 없는 error는 헤더 라인만", () => {
    const { text } = serializeConsoleEntry(makeEntry());

    expect(text).toBe("[error] Uncaught TypeError: x is not a function");
  });

  it("error가 아니면 stack이 있어도 포함하지 않는다", () => {
    const { text } = serializeConsoleEntry(
      makeEntry({ level: "warn", args: "deprecated API", stack: "  at foo (app.js:1:1)" }),
    );

    expect(text).toBe("[warn] deprecated API");
  });

  it("args의 라인 시작 백틱 런도 무해화한다", () => {
    const { text } = serializeConsoleEntry(makeEntry({ level: "log", args: "a\n```\nb" }));

    expect(text).not.toMatch(/^ {0,3}`{3,}/m);
  });

  it("16384자를 넘는 stack도 자른다 (args와 같은 캡)", () => {
    const { text } = serializeConsoleEntry(
      makeEntry({ args: "boom", stack: "s".repeat(20000) }),
    );

    expect(text).toBe(`[error] boom\n${"s".repeat(16384)}…(truncated)`);
  });

  it("16384자를 넘는 args는 자르고 …(truncated) 표시", () => {
    const { text } = serializeConsoleEntry(makeEntry({ level: "log", args: "y".repeat(20000) }));

    expect(text).toBe(`[log] ${"y".repeat(16384)}…(truncated)`);
  });
});
