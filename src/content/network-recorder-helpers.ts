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
