// LLM 응답에서 JSON 객체 본문만 뽑아낸다. markdown 펜스 제거 후 첫 { ~ 마지막 } 범위.
export function extractJson(raw: string): string | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}
