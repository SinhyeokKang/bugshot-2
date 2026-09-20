// 브라우저가 설정을 거부하는 요청 헤더는 fetch가 **조용히 드롭**한다(문법 오류만 throw).
// declarativeNetRequest 권한이 없어 우회 수단도 없으므로, 저장 시점 거부가 유일한 방어다.
// 통과시키면 "넣었는데 안 나간다"가 되고 사용자는 원인을 알 방법이 없다.
const FORBIDDEN = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

// RFC 7230 token. 여기를 통과 못 하면 Headers 생성자가 TypeError를 던져 요청이 통째로 죽는다.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isSettableHeaderName(name: string): boolean {
  if (!TOKEN.test(name)) return false;
  const lower = name.toLowerCase();
  if (FORBIDDEN.has(lower)) return false;
  // Proxy-*·Sec-* 는 접두사 전체가 금지라 열거하지 않는다 — 열거하면 다음 Sec- 헤더에서 샌다.
  if (lower.startsWith("proxy-") || lower.startsWith("sec-")) return false;
  return true;
}
