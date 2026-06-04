import { describe, it, expect, beforeAll } from "vitest";
import type { NetworkLog, NetworkRequest } from "@/types/network";

let buildHar: (log: NetworkLog) => object;
let serializeHar: (har: object) => string;

beforeAll(async () => {
  const mod = await import("../buildHar");
  // version은 이제 인자 — 테스트 호출부 유지를 위해 래퍼로 주입.
  buildHar = (log: NetworkLog) => mod.buildHar(log, "1.0.0");
  serializeHar = mod.serializeHar;
});

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "req-1",
    url: "https://example.com/api/data?foo=bar",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: 1700000000000,
    durationMs: 150,
    requestHeaders: { "accept": "application/json" },
    responseHeaders: { "content-type": "application/json" },
    pageUrl: "https://example.com",
    requestBodySize: 0,
    responseBodySize: 42,
    contentType: "application/json",
    phase: "complete",
    ...overrides,
  };
}

function makeLog(requests: NetworkRequest[]): NetworkLog {
  return {
    id: "log-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: requests.length,
    captured: requests.length,
    warnings: [],
    requests,
  };
}

describe("buildHar", () => {
  it("기본 HAR 구조", () => {
    const har = buildHar(makeLog([makeRequest()])) as any;
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator.name).toBe("BugShot");
    expect(har.log.creator.version).toBe("1.0.0");
    expect(har.log.entries).toHaveLength(1);
  });

  it("쿼리스트링 파싱", () => {
    const har = buildHar(makeLog([makeRequest()])) as any;
    const qs = har.log.entries[0].request.queryString;
    expect(qs).toEqual([{ name: "foo", value: "bar" }]);
  });

  it("string requestBody", () => {
    const req = makeRequest({
      method: "POST",
      requestBody: '{"key":"value"}',
      requestBodySize: 15,
      requestHeaders: { "content-type": "application/json" },
    });
    const har = buildHar(makeLog([req])) as any;
    const postData = har.log.entries[0].request.postData;
    expect(postData.text).toBe('{"key":"value"}');
    expect(postData.mimeType).toBe("application/json");
  });

  it("truncated requestBody — comment에 실제 size/limit 표기", () => {
    const req = makeRequest({
      method: "POST",
      requestBody: { kind: "truncated", limit: 3 * 1024 * 1024, size: 5 * 1024 * 1024 },
      requestBodySize: 5 * 1024 * 1024,
      requestHeaders: { "content-type": "application/json" },
    });
    const har = buildHar(makeLog([req])) as any;
    const postData = har.log.entries[0].request.postData;
    expect(postData.text).toBe("");
    expect(postData.comment).toContain("truncated");
    expect(postData.comment).toMatch(/5\.0 MB/);
    expect(postData.comment).toMatch(/3\.0 MB/);
  });

  it("string responseBody", () => {
    const req = makeRequest({ responseBody: '{"ok":true}', responseBodySize: 11 });
    const har = buildHar(makeLog([req])) as any;
    const content = har.log.entries[0].response.content;
    expect(content.text).toBe('{"ok":true}');
    expect(content.size).toBe(11);
  });

  it("binary responseBody — comment에 contentType/size 표기", () => {
    const req = makeRequest({
      responseBody: { kind: "binary", contentType: "image/png", size: 500 },
      responseBodySize: 500,
    });
    const har = buildHar(makeLog([req])) as any;
    const content = har.log.entries[0].response.content;
    expect(content.comment).toContain("Binary");
    expect(content.comment).toContain("image/png");
    expect(content.comment).toContain("500 B");
  });

  it("undefined body → no text field", () => {
    const req = makeRequest({ responseBody: undefined });
    const har = buildHar(makeLog([req])) as any;
    const content = har.log.entries[0].response.content;
    expect(content.text).toBeUndefined();
  });

  it("잘못된 URL은 빈 queryString", () => {
    const req = makeRequest({ url: "not-a-url" });
    const har = buildHar(makeLog([req])) as any;
    expect(har.log.entries[0].request.queryString).toEqual([]);
  });

  it("_bugshot 메타 필드 — phase·responseBodyKind 포함", () => {
    const req = makeRequest({ responseBody: { kind: "stream", contentType: "text/event-stream" } });
    const har = buildHar(makeLog([req])) as any;
    const meta = har.log.entries[0]._bugshot;
    expect(meta.id).toBe("req-1");
    expect(meta.responseBodyKind).toBe("stream");
    expect(meta.phase).toBe("complete");
  });

  it("phase=pending entry도 HAR에 포함", () => {
    const req = makeRequest({ phase: "pending", status: 0, statusText: "", durationMs: 0 });
    const har = buildHar(makeLog([req])) as any;
    expect(har.log.entries[0]._bugshot.phase).toBe("pending");
    expect(har.log.entries[0].response.status).toBe(0);
  });
});

describe("serializeHar", () => {
  it("JSON 포맷팅", () => {
    const json = serializeHar({ log: { version: "1.2" } });
    expect(json).toContain('"version": "1.2"');
    expect(json).toContain("  ");
  });
});
