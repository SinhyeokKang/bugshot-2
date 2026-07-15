export type NetworkRequestBody =
  | string
  | { kind: "truncated"; limit: number; size: number }
  | { kind: "binary"; contentType: string; size: number }
  | { kind: "stream"; contentType: string }
  | { kind: "omitted"; reason: "memory-cap" };

export type NetworkRequestPhase = "pending" | "complete" | "error";

export type WebSocketFrameDirection = "send" | "receive" | "open" | "close";

// 바이너리 프레임은 저장하지 않으므로 "binary" 변종 없음.
export type WebSocketFrameData =
  | string
  | { kind: "truncated"; limit: number; size: number };

export interface WebSocketFrame {
  seq: number; // 적재 순번 — FIFO evict로 인덱스가 밀려도 불변(React key·펼침 상태 식별용)
  direction: WebSocketFrameDirection;
  ts: number; // 프레임 발생 시각(절대 ms)
  data?: WebSocketFrameData; // open은 undefined; send/receive는 텍스트; close는 reason(있으면)
  size: number; // payload 크기(open/close 등 control은 0)
  code?: number; // close 전용
  reason?: string; // close 전용
  wasClean?: boolean; // close 전용
}

export interface WebSocketMeta {
  protocol: string; // 협상된 서브프로토콜(없으면 "")
  frames: WebSocketFrame[]; // 연결당 프레임 캡(MAX_WS_FRAMES_PER_CONN) 적용된 보유분
  framesTotal: number; // 캡처 시도 총 프레임 수(드롭된 바이너리·evict 포함)
}

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
  // 존재하면 이 엔트리는 WebSocket 연결(status 101, method "WS").
  webSocket?: WebSocketMeta;
}

export interface NetworkLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  warnings: ("MEMORY_CAPPED" | "WS_FRAMES_CAPPED" | "BODY_TRUNCATED" | "ENTRY_CAPPED")[];
  requests: NetworkRequest[];
}
