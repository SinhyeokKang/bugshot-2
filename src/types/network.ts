export type NetworkRequestBody =
  | string
  | { kind: "truncated"; limit: number; size: number }
  | { kind: "binary"; contentType: string; size: number }
  | { kind: "stream"; contentType: string }
  | { kind: "omitted"; reason: "memory-cap" };

export type NetworkRequestPhase = "pending" | "complete" | "error";

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  startTime: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: NetworkRequestBody;
  responseBody?: NetworkRequestBody;
  pageUrl: string;
  requestBodySize: number;
  responseBodySize: number;
  contentType: string;
  phase: NetworkRequestPhase;
  // pre-arm 버퍼링으로 sentinel 도착 전(페이지 로드 초반) 캡처됨 → reload logClear 경계 우회 보존.
  preArm?: boolean;
}

export interface NetworkLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  warnings: ("MEMORY_CAPPED" | "WS_UNSUPPORTED" | "BODY_TRUNCATED" | "ENTRY_CAPPED")[];
  requests: NetworkRequest[];
}

export interface NetworkLogSelection {
  selectedIds: string[];
}
