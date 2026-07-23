import type { NetworkRequestBody } from "@/types/network";

// 최상위 키·타입만. 값은 제외(프라이버시).
const MAX_KEYS = 30;
const MAX_DIGEST_CHARS = 400;

// 스키마성 키(코드 식별자)만 인쇄하고 데이터성 키는 가린다. 맵/딕셔너리형 응답
// ({"john@corp.com":{…}})은 키가 곧 PII·레코드 데이터라 그대로 나가면 "값은 안 나감"이 깨진다.
// 이메일(@)·UUID(-)·공백·점 포함·40자 초과는 식별자 패턴에 안 걸려 <key>로 치환.
const SCHEMA_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
function safeKey(k: string): string {
  return SCHEMA_KEY_RE.test(k) ? k : "<key>";
}

function typeTag(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `arr[${v.length}]`;
  switch (typeof v) {
    case "string":
      return "str";
    case "number":
      return "num";
    case "boolean":
      return "bool";
    default:
      return "obj"; // 중첩 객체는 depth 1로 축약
  }
}

// json 응답 본문의 shape 다이제스트. 값 제외, bounded 출력.
// 비-json·omission 변종·파싱 실패·최상위 primitive → undefined(호출부는 provenance만 인쇄).
export function digestResponseShape(
  body: NetworkRequestBody | undefined,
  contentType: string,
): string | undefined {
  if (typeof body !== "string") return undefined;
  if (!/json/i.test(contentType)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (Array.isArray(parsed)) return `arr[${parsed.length}]`;
  if (parsed === null || typeof parsed !== "object") return undefined; // 최상위 primitive

  const entries = Object.entries(parsed as Record<string, unknown>);
  const parts = entries.slice(0, MAX_KEYS).map(([k, v]) => `${safeKey(k)}:${typeTag(v)}`);
  if (entries.length > MAX_KEYS) parts.push("…");

  let digest = `{${parts.join(" ")}}`;
  if (digest.length > MAX_DIGEST_CHARS) {
    digest = `${digest.slice(0, MAX_DIGEST_CHARS - 2)}…}`;
  }
  return digest;
}
