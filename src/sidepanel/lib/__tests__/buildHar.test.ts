import { describe, it, expect, vi, beforeAll } from "vitest";
import type { NetworkLog, NetworkRequest } from "@/types/network";

let buildHar: (log: NetworkLog) => object;
let serializeHar: (har: object) => string;

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "1.0.0" }) },
  });
  const mod = await import("../buildHar");
  buildHar = mod.buildHar;
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

  it("truncated requestBody", () => {
    const req = makeRequest({
      method: "POST",
      requestBody: { kind: "truncated" },
      requestBodySize: 2000000,
      requestHeaders: { "content-type": "application/json" },
    });
    const har = buildHar(makeLog([req])) as any;
    const postData = har.log.entries[0].request.postData;
    expect(postData.text).toBe("");
    expect(postData.comment).toContain("truncated");
  });

  it("string responseBody", () => {
    const req = makeRequest({ responseBody: '{"ok":true}', responseBodySize: 11 });
    const har = buildHar(makeLog([req])) as any;
    const content = har.log.entries[0].response.content;
    expect(content.text).toBe('{"ok":true}');
    expect(content.size).toBe(11);
  });

  it("binary responseBody", () => {
    const req = makeRequest({ responseBody: { kind: "binary" }, responseBodySize: 500 });
    const har = buildHar(makeLog([req])) as any;
    const content = har.log.entries[0].response.content;
    expect(content.comment).toContain("Binary");
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

  it("_bugshot 메타 필드", () => {
    const req = makeRequest({ responseBody: { kind: "stream" } });
    const har = buildHar(makeLog([req])) as any;
    const meta = har.log.entries[0]._bugshot;
    expect(meta.id).toBe("req-1");
    expect(meta.responseBodyKind).toBe("stream");
  });
});

describe("serializeHar", () => {
  it("JSON 포맷팅", () => {
    const json = serializeHar({ log: { version: "1.2" } });
    expect(json).toContain('"version": "1.2"');
    expect(json).toContain("  ");
  });
});
