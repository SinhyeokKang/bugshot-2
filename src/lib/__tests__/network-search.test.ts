import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@/types/network";
import { requestMatchesQuery } from "../network-search";

function req(over: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: "1",
    url: "https://api.example.com/x",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: 0,
    durationMs: 0,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://example.com",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete",
    ...over,
  };
}

describe("requestMatchesQuery", () => {
  // lowerQuery는 비어있지 않고 이미 소문자임을 전제 (caller가 보장).

  describe("URL", () => {
    it("URL에 포함되면 true", () => {
      expect(requestMatchesQuery(req({ url: "https://api.example.com/users/42" }), "users")).toBe(true);
    });

    it("URL 대문자 경로도 소문자 쿼리로 매칭 (대소문자 무시)", () => {
      expect(requestMatchesQuery(req({ url: "https://API.example.com/Profile" }), "profile")).toBe(true);
    });
  });

  describe("본문 (string)", () => {
    it("requestBody에만 포함되면 true", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", requestBody: '{"email":"foo@bar.com"}' }), "foo@bar"),
      ).toBe(true);
    });

    it("responseBody에만 포함되면 true", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", responseBody: '{"error":"invalid_grant"}' }), "invalid_grant"),
      ).toBe(true);
    });

    it("본문 대문자도 소문자 쿼리로 매칭", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", responseBody: "TOKEN_EXPIRED" }), "token_expired"),
      ).toBe(true);
    });
  });

  describe("헤더 (키·값)", () => {
    it("requestHeaders 키에 포함되면 true", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", requestHeaders: { "X-Trace-Id": "abc" } }), "x-trace-id"),
      ).toBe(true);
    });

    it("requestHeaders 값에 포함되면 true", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", requestHeaders: { accept: "application/json" } }), "application/json"),
      ).toBe(true);
    });

    it("responseHeaders 키/값에 포함되면 true", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", responseHeaders: { "content-type": "text/html" } }), "text/html"),
      ).toBe(true);
    });
  });

  describe("비문자열 본문 variant — throw 없이 본문 매칭 안 됨", () => {
    it("truncated 본문은 매칭 안 됨", () => {
      expect(
        requestMatchesQuery(
          req({ url: "https://x.com/a", responseBody: { kind: "truncated", limit: 3000, size: 9000 } }),
          "truncated",
        ),
      ).toBe(false);
    });

    it("binary 본문은 매칭 안 됨", () => {
      expect(
        requestMatchesQuery(
          req({ url: "https://x.com/a", responseBody: { kind: "binary", contentType: "image/png", size: 100 } }),
          "image",
        ),
      ).toBe(false);
    });

    it("stream 본문은 매칭 안 됨", () => {
      expect(
        requestMatchesQuery(
          req({ url: "https://x.com/a", responseBody: { kind: "stream", contentType: "text/event-stream" } }),
          "stream",
        ),
      ).toBe(false);
    });

    it("omitted 본문은 매칭 안 됨", () => {
      expect(
        requestMatchesQuery(
          req({ url: "https://x.com/a", requestBody: { kind: "omitted", reason: "memory-cap" } }),
          "memory-cap",
        ),
      ).toBe(false);
    });
  });

  describe("빈/없는 필드 — throw 없음", () => {
    it("본문 undefined·헤더 빈 객체여도 URL로 매칭", () => {
      expect(
        requestMatchesQuery(
          req({ url: "https://x.com/найти", requestBody: undefined, responseBody: undefined, requestHeaders: {}, responseHeaders: {} }),
          "найти",
        ),
      ).toBe(true);
    });
  });

  describe("마스킹", () => {
    it("마스킹된 본문 값(***)은 그대로 검색됨", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", requestBody: '{"password":"***"}' }), "***"),
      ).toBe(true);
    });

    it("마스킹된 헤더 값(***[len:N])의 원문은 매칭 안 됨", () => {
      expect(
        requestMatchesQuery(req({ url: "https://x.com/a", requestHeaders: { authorization: "***[len:64]" } }), "secret-token"),
      ).toBe(false);
    });
  });

  describe("매칭 없음", () => {
    it("URL·본문·헤더 어디에도 없으면 false", () => {
      expect(
        requestMatchesQuery(
          req({
            url: "https://api.example.com/users",
            requestBody: '{"name":"alice"}',
            responseBody: '{"id":1}',
            requestHeaders: { accept: "application/json" },
            responseHeaders: { "content-type": "application/json" },
          }),
          "zzz-nomatch",
        ),
      ).toBe(false);
    });
  });
});
