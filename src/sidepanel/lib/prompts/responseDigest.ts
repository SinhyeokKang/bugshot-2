import type { NetworkRequestBody } from "@/types/network";

// 최상위 키·타입만. 값은 제외(프라이버시).
const MAX_KEYS = 30;
const MAX_DIGEST_CHARS = 400;
const MAP_KEY_THRESHOLD = 8; // 이보다 많은 키 + 값 타입 균일 → map으로 보고 키 미인쇄

// 값의 기본 종류(배열 길이 무시) — map 균일성 판정·collapse 라벨용.
function baseKind(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "arr";
  switch (typeof v) {
    case "string":
      return "str";
    case "number":
      return "num";
    case "boolean":
      return "bool";
    default:
      return "obj";
  }
}

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

  // map/dictionary형(키 >8 + 값 타입 균일) 감지 → 개별 키를 인쇄하지 않고 통째로 축약.
  // 이 형태는 키가 스키마가 아니라 데이터(레코드ID·이메일)라, safeKey로도 접두-토큰 ID
  // (cus_H3k9xY2z 등)가 새므로 통째로 가린다. 이 판정을 벗어나는 map(≤8키·값 타입 혼합)은
  // 아래 safeKey 경로로 폴백 — 이메일·UUID는 redact되나 식별자형 레코드ID는 통과(수용 경계).
  if (entries.length > MAP_KEY_THRESHOLD) {
    const kinds = new Set(entries.map(([, v]) => baseKind(v)));
    if (kinds.size === 1) return `{${entries.length} entries: ${[...kinds][0]}}`;
  }

  const parts = entries.slice(0, MAX_KEYS).map(([k, v]) => `${safeKey(k)}:${typeTag(v)}`);
  if (entries.length > MAX_KEYS) parts.push("…");

  let digest = `{${parts.join(" ")}}`;
  if (digest.length > MAX_DIGEST_CHARS) {
    digest = `${digest.slice(0, MAX_DIGEST_CHARS - 2)}…}`;
  }
  return digest;
}
