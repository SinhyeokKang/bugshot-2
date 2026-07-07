import { parseInlineStyle, serializeInlineStyle } from "./inlineCssText";

export function serializeCssBlock(
  selector: string,
  decls: Record<string, string>,
): string {
  const body = serializeInlineStyle(decls);
  if (!body) return `${selector} {\n}`;
  const indented = body
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return `${selector} {\n${indented}\n}`;
}

export function parseCssBlock(text: string): Record<string, string> {
  const open = text.indexOf("{");
  if (open === -1) return parseInlineStyle(text);
  const close = text.lastIndexOf("}");
  const body = close > open ? text.slice(open + 1, close) : text.slice(open + 1);
  return parseInlineStyle(body);
}

// specified 대비 diff. 값이 다르거나 새로 추가된 prop만 오버라이드로 남기고,
// specified에 있었으나 edited에서 빠진 prop은 `initial` 원복으로 방출(삭제=원복).
export function computeOverrides(
  edited: Record<string, string>,
  specified: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prop, value] of Object.entries(edited)) {
    if (specified[prop] !== value) result[prop] = value;
  }
  for (const prop of Object.keys(specified)) {
    if (!(prop in edited)) result[prop] = "initial";
  }
  return result;
}
