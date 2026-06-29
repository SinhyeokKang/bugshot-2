export type LogTextToken =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string };

const URL_RE = /https?:\/\/[^\s)'"<>]+/g;
const TRAILING_PUNCT_RE = /[.,;!?]+$/;
const LINE_COL_RE = /:\d+(?::\d+)?$/;

// 끝의 :line(:col)을 href에서 떼되, 경로가 있을 때만. 경로 없는 host:port(http://localhost:3000)는
// 포트가 line으로 오인돼 깎이는 걸 막는다(표시값과 목적지 불일치 방지).
function hrefFromValue(value: string): string {
  const afterScheme = value.replace(/^https?:\/\//, "");
  return afterScheme.includes("/") ? value.replace(LINE_COL_RE, "") : value;
}

export function tokenizeLogText(text: string): LogTextToken[] {
  const tokens: LogTextToken[] = [];
  let cursor = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const matchEnd = m.index + m[0].length;
    const value = m[0].replace(TRAILING_PUNCT_RE, "");
    const trailingLen = m[0].length - value.length;
    if (m.index > cursor) {
      tokens.push({ type: "text", value: text.slice(cursor, m.index) });
    }
    tokens.push({ type: "url", value, href: hrefFromValue(value) });
    cursor = matchEnd - trailingLen;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", value: text.slice(cursor) });
  }
  return tokens;
}
