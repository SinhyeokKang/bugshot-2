import { describe, expect, it } from "vitest";
import type { NetworkRequest } from "@/types/network";
import { isStatusHidden } from "../network-status";

function req(over: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: "1",
    url: "https://api.example.com/x",
    method: "GET",
    status: 0,
    statusText: "",
    startTime: 0,
    durationMs: 0,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://example.com",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "",
    phase: "error",
    ...over,
  };
}

describe("isStatusHidden", () => {
  it("CORS/연결 실패 (error + status 0 + Network Error) → true", () => {
    expect(
      isStatusHidden(req({ phase: "error", status: 0, statusText: "Network Error" })),
    ).toBe(true);
  });

  it("정상 응답 200 → false", () => {
    expect(
      isStatusHidden(req({ phase: "complete", status: 200, statusText: "OK" })),
    ).toBe(false);
  });

  it("서버 에러지만 응답을 읽은 503 → false (가려지지 않음)", () => {
    expect(
      isStatusHidden(
        req({ phase: "complete", status: 503, statusText: "Service Unavailable" }),
      ),
    ).toBe(false);
  });

  it("취소된 요청 (Aborted) → false", () => {
    expect(
      isStatusHidden(req({ phase: "error", status: 0, statusText: "Aborted" })),
    ).toBe(false);
  });

  it("타임아웃 (Timeout) → false", () => {
    expect(
      isStatusHidden(req({ phase: "error", status: 0, statusText: "Timeout" })),
    ).toBe(false);
  });

  it("sendBeacon 큐잉 (complete + status 0 + Queued) → false", () => {
    expect(
      isStatusHidden(req({ phase: "complete", status: 0, statusText: "Queued" })),
    ).toBe(false);
  });

  it("pending 상태 → false", () => {
    expect(isStatusHidden(req({ phase: "pending", status: 0, statusText: "" }))).toBe(
      false,
    );
  });
});

// statusText는 UI 번역을 위해 statusKind로 분류를 병기하지만, 이미 저장된 로그
// (IndexedDB networkLogs · chrome.storage.session)에는 statusKind가 없다.
describe("isStatusHidden — statusKind 우선 + statusText 폴백", () => {
  it("statusKind가 networkError면 statusText와 무관하게 true", () => {
    expect(
      isStatusHidden(
        req({ phase: "error", status: 0, statusText: "", statusKind: "networkError" }),
      ),
    ).toBe(true);
  });

  it("statusKind가 aborted면 false", () => {
    expect(
      isStatusHidden(
        req({ phase: "error", status: 0, statusText: "Aborted", statusKind: "aborted" }),
      ),
    ).toBe(false);
  });

  it("statusKind가 timeout이면 false", () => {
    expect(
      isStatusHidden(
        req({ phase: "error", status: 0, statusText: "Timeout", statusKind: "timeout" }),
      ),
    ).toBe(false);
  });

  it("statusKind가 있으면 statusText 폴백을 타지 않는다", () => {
    expect(
      isStatusHidden(
        req({
          phase: "error",
          status: 0,
          statusText: "Network Error",
          statusKind: "aborted",
        }),
      ),
    ).toBe(false);
  });

  it("statusKind가 없는 옛 저장 로그는 statusText 폴백으로 판정한다", () => {
    expect(
      isStatusHidden(req({ phase: "error", status: 0, statusText: "Network Error" })),
    ).toBe(true);
    expect(
      isStatusHidden(req({ phase: "error", status: 0, statusText: "Aborted" })),
    ).toBe(false);
  });

  it("networkError여도 phase가 error가 아니면 false", () => {
    expect(
      isStatusHidden(
        req({ phase: "complete", status: 200, statusText: "OK", statusKind: "networkError" }),
      ),
    ).toBe(false);
  });
});
