export type LogTextToken =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string };

const URL_RE = /https?:\/\/[^\s)'"<>]+/g;
const TRAILING_PUNCT_RE = /[.,;!?]+$/;
const LINE_COL_RE = /:\d+(?::\d+)?$/;

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
    tokens.push({ type: "url", value, href: value.replace(LINE_COL_RE, "") });
    cursor = matchEnd - trailingLen;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", value: text.slice(cursor) });
  }
  return tokens;
}
