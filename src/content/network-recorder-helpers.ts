import type { NetworkRequestBody } from "@/types/network";

export type NetworkBodyOmission = Exclude<NetworkRequestBody, string>;

export const BODY_CAP = 3 * 1024 * 1024; // 3 MB

export const MASKED_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "pwd",
  "auth",
]);
const MASKED_BODY_KEYS = MASKED_QUERY_KEYS;

function maskJsonBody(val: unknown, depth: number): unknown {
  if (depth > 10) return val;
  if (Array.isArray(val)) {
    return val.map((item) => maskJsonBody(item, depth + 1));
  }
  if (val && typeof val === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (MASKED_BODY_KEYS.has(k.toLowerCase())) {
        result[k] = "***";
      } else {
        result[k] = maskJsonBody(v, depth + 1);
      }
    }
    return result;
  }
  return val;
}

// 요청·응답 본문 공용 민감 키 마스킹 (json/urlencoded만, 그 외 타입은 원문 유지).
export function maskBody(body: string, contentType: string): string {
  if (/^application\/json/i.test(contentType)) {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(maskJsonBody(parsed, 0));
    } catch { return body; }
  }
  if (/^application\/x-www-form-urlencoded/i.test(contentType)) {
    try {
      const params = new URLSearchParams(body);
      let changed = false;
      for (const key of params.keys()) {
        if (MASKED_BODY_KEYS.has(key.toLowerCase())) {
          params.set(key, "***");
          changed = true;
        }
      }
      return changed ? params.toString() : body;
    } catch { return body; }
  }
  return body;
}

// WebSocket 텍스트 프레임만 캡처. 바이너리(ArrayBuffer/Blob/TypedArray/SharedArrayBuffer)는
// null로 드롭, BODY_CAP 초과 텍스트는 truncated로 분류. 문자열(빈 문자열 포함)은 그대로.
// size는 beacon/request 헬퍼와 동일하게 문자열 길이 기준.
export function classifyWsFrameData(
  data: unknown,
): string | { kind: "truncated"; limit: number; size: number } | null {
  if (typeof data !== "string") return null;
  if (data.length > BODY_CAP) {
    return { kind: "truncated", limit: BODY_CAP, size: data.length };
  }
  return data;
}

// WebSocket 텍스트 프레임의 민감 키 마스킹 — 기존 본문 마스킹 경로 재사용.
export function maskWsFrame(text: string): string {
  return maskBody(text, "application/json");
}

const CONTENT_TYPE_DENYLIST = [
  /^image\//i,
  /^audio\//i,
  /^video\//i,
  /^font\//i,
  /^text\/event-stream/i, // SSE — 무한 스트림. 끝까지 read하면 메모리·지연 유발하므로 본문 캡처 제외.
  /^application\/pdf$/i,
  /^application\/wasm$/i,
  /^application\/octet-stream$/i,
];

const CONTENT_TYPE_ALLOWLIST = [
  /^application\/json/i,
  /^text\//i,
  /^application\/xml/i,
  /^application\/x-www-form-urlencoded/i,
];

function isDeniedContentType(ct: string): boolean {
  return CONTENT_TYPE_DENYLIST.some((p) => p.test(ct));
}

function isAllowedContentType(ct: string): boolean {
  return CONTENT_TYPE_ALLOWLIST.some((p) => p.test(ct));
}

// 응답 body 분류 — null 반환 시 호출부가 실제 stream read를 수행.
// truncated/binary는 contentLength·contentType만으로 결정 가능한 케이스.
export function classifyResponseBody(input: {
  contentType: string;
  contentLength: number;
}): NetworkBodyOmission | null {
  const { contentType } = input;
  const size = Number.isFinite(input.contentLength) ? input.contentLength : 0;

  if (isDeniedContentType(contentType)) {
    return { kind: "binary", contentType, size };
  }
  if (Number.isFinite(input.contentLength) && input.contentLength > BODY_CAP) {
    return { kind: "truncated", limit: BODY_CAP, size: input.contentLength };
  }
  if (!isAllowedContentType(contentType)) {
    return { kind: "binary", contentType, size };
  }
  return null;
}

export interface BeaconBodyResult {
  body: NetworkRequestBody | undefined;
  size: number;
  contentType: string;
}

// sendBeacon용 분류. 동기 결과만 — Blob/FormData/ArrayBuffer는 항상 binary.
export function classifyBeaconBody(data: BodyInit | null | undefined): BeaconBodyResult {
  if (data == null) return { body: undefined, size: 0, contentType: "" };

  if (typeof data === "string") {
    const size = data.length;
    if (size > BODY_CAP) {
      return { body: { kind: "truncated", limit: BODY_CAP, size }, size, contentType: "" };
    }
    return { body: data, size, contentType: "" };
  }
  if (data instanceof Blob) {
    return {
      body: { kind: "binary", contentType: data.type, size: data.size },
      size: data.size,
      contentType: data.type,
    };
  }
  if (data instanceof URLSearchParams) {
    const str = data.toString();
    const size = str.length;
    const contentType = "application/x-www-form-urlencoded";
    if (size > BODY_CAP) {
      return { body: { kind: "truncated", limit: BODY_CAP, size }, size, contentType };
    }
    return { body: str, size, contentType };
  }
  if (data instanceof FormData) {
    return { body: { kind: "binary", contentType: "multipart/form-data", size: 0 }, size: 0, contentType: "multipart/form-data" };
  }
  if (data instanceof ArrayBuffer) {
    return { body: { kind: "binary", contentType: "", size: data.byteLength }, size: data.byteLength, contentType: "" };
  }
  if (ArrayBuffer.isView(data)) {
    return { body: { kind: "binary", contentType: "", size: data.byteLength }, size: data.byteLength, contentType: "" };
  }
  return { body: undefined, size: 0, contentType: "" };
}

export interface PatchedFetchReqInfo {
  method: string;
  url: string; // raw (마스킹 전)
  requestHeaders: Record<string, string>; // raw
  contentType: string; // body 마스킹용
  rawBody?: string; // string / URLSearchParams body만 (마스킹 전)
  requestBodySize: number;
}

export type FetchSettle = (outcome: {
  response?: Response;
  error?: unknown;
}) => void | Promise<void>;

// 요청을 buffer에 기록하고, 완료/에러 시 호출할 settle을 반환하는 훅.
export type FetchRecordHook = (info: PatchedFetchReqInfo) => FetchSettle;

export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((v, k) => {
    result[k] = v;
  });
  return result;
}

function extractRequestInfo(req: Request, init?: RequestInit): PatchedFetchReqInfo {
  let rawBody: string | undefined;
  let requestBodySize = 0;
  let contentType = req.headers.get("content-type") || "";
  const body = init?.body;
  if (typeof body === "string") {
    rawBody = body;
    requestBodySize = body.length;
  } else if (body instanceof URLSearchParams) {
    rawBody = body.toString();
    requestBodySize = rawBody.length;
    contentType = "application/x-www-form-urlencoded";
  }
  return {
    method: req.method,
    url: req.url,
    requestHeaders: headersToRecord(req.headers),
    contentType,
    rawBody,
    requestBodySize,
  };
}

// fetch wrap. 두 원칙으로 페이지 요청을 절대 방해하지 않는다:
// 1) `new Request(input, init)`로 만든 req를 그대로 보낸다 — 원본 input/init 재전송 시
//    Request·ReadableStream body가 이미 소비돼 "body already used"로 실패(GitHub 업로드 회귀).
//    req 생성 실패 시 원본 폴백.
// 2) settle(응답 본문 읽기)은 await하지 않는다 — 스트리밍/대용량 응답에서 페이지 fetch가
//    본문 끝까지 블록된다. record/settle 예외도 삼켜 페이지로 전파하지 않는다.
export function createPatchedFetch(
  originalFetch: typeof fetch,
  record?: FetchRecordHook,
  shouldRecord?: () => boolean,
): typeof fetch {
  return async function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // recording이 꺼져 있으면 new Request 재구성·record 없이 원본 input/init 그대로 통과
    // (XHR `if (!recording)` 가드와 대칭 — SigV4 등 본문 재구성 회귀 방지).
    if (shouldRecord && !shouldRecord()) {
      return originalFetch.call(this, input, init);
    }

    let req: Request | null = null;
    try {
      req = new Request(input, init);
    } catch {
      req = null;
    }
    if (!record || !req) {
      return req
        ? originalFetch.call(this, req)
        : originalFetch.call(this, input, init);
    }

    let settle: FetchSettle | undefined;
    try {
      settle = record(extractRequestInfo(req, init));
    } catch {
      settle = undefined;
    }

    let response: Response;
    try {
      response = await originalFetch.call(this, req);
    } catch (error) {
      runSettle(settle, { error });
      throw error;
    }
    runSettle(settle, { response });
    return response;
  } as typeof fetch;
}

// settle을 fire-and-forget으로 호출하고 동기 throw·비동기 reject를 모두 삼킨다.
function runSettle(settle: FetchSettle | undefined, outcome: { response?: Response; error?: unknown }): void {
  if (!settle) return;
  try {
    Promise.resolve(settle(outcome)).catch(() => {});
  } catch {
    /* 레코더 오류는 페이지 요청에 영향 주지 않는다 */
  }
}
