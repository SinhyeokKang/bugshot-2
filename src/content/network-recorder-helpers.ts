import type { NetworkRequestBody } from "@/types/network";

export type NetworkBodyOmission = Exclude<NetworkRequestBody, string>;

export const BODY_CAP = 3 * 1024 * 1024; // 3 MB

const CONTENT_TYPE_DENYLIST = [
  /^image\//i,
  /^audio\//i,
  /^video\//i,
  /^font\//i,
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

// fetch wrap. 핵심: `new Request(input, init)`로 만든 req를 그대로 전송한다.
// 원본 input/init을 다시 originalFetch에 넘기면, input이 Request 객체이거나
// body가 ReadableStream일 때 본문이 이미 소비돼 "body already used"로 요청이
// 실패한다(GitHub 업로드 등 회귀). req 생성에 실패하면 원본으로 폴백.
export function createPatchedFetch(
  originalFetch: typeof fetch,
  record?: FetchRecordHook,
): typeof fetch {
  return async function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
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

    const settle = record(extractRequestInfo(req, init));
    let response: Response;
    try {
      response = await originalFetch.call(this, req);
    } catch (error) {
      await settle({ error });
      throw error;
    }
    await settle({ response });
    return response;
  } as typeof fetch;
}
