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

  // 같은 statusText에서 statusKind 유무가 답을 가르는 쌍 — 폴백을 지우면 앞이, statusKind
  // 우선을 지우면 뒤가 깨진다. 옛 저장 로그(statusKind 없음) 하위호환이 이 앞줄이다.
  it("같은 statusText라도 statusKind 유무로 판정이 갈린다", () => {
    expect(
      isStatusHidden(req({ phase: "error", status: 0, statusText: "Network Error" })),
    ).toBe(true);
    expect(
      isStatusHidden(
        req({ phase: "error", status: 0, statusText: "Network Error", statusKind: "timeout" }),
      ),
    ).toBe(false);
  });

  // statusKind 검사를 phase 검사 위로 올리면 깨지는 순서 가드.
  it("networkError여도 phase가 error가 아니면 false", () => {
    expect(
      isStatusHidden(
        req({ phase: "complete", status: 200, statusText: "OK", statusKind: "networkError" }),
      ),
    ).toBe(false);
  });
});
