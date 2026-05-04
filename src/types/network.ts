export type NetworkRequestBody =
  | string
  | { kind: "truncated" | "stream" | "binary" | "omitted" };

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
}

export interface NetworkLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  warnings: ("MEMORY_CAPPED" | "WS_UNSUPPORTED" | "BODY_TRUNCATED")[];
  requests: NetworkRequest[];
}

export interface NetworkLogSelection {
  selectedIds: string[];
}
