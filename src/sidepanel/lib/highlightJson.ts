// 삽입된 로그 코드블럭의 JSON 하이라이팅 단일 출처 — drafting 에디터(ProseMirror decoration)와
// preview(markdown-it highlight)가 같은 토큰·같은 색을 쓴다. 로그를 고르는 다이얼로그의
// JsonTreeViewer와도 팔레트를 공유해, 같은 응답이 세 화면에서 다른 색으로 보이지 않게 한다.
export type JsonTokenKind = "key" | "string" | "number" | "boolean" | "null";

export interface JsonToken {
  text: string;
  kind: JsonTokenKind | null; // null이면 평문(구두점·헤더 라인·구분자)
}

export const JSON_TOKEN_CLASS: Record<JsonTokenKind, string> = {
  string: "text-red-700 dark:text-red-400",
  number: "text-blue-700 dark:text-blue-400",
  boolean: "text-blue-700 dark:text-blue-400",
  null: "text-muted-foreground italic",
  key: "text-purple-700 dark:text-purple-400",
};

// 문자열(이스케이프 허용) / 숫자 / true·false / null. 나머지는 전부 평문으로 흘린다.
const TOKEN = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;

export function tokenizeJson(code: string): JsonToken[] {
  if (!code) return [];

  const out: JsonToken[] = [];
  let last = 0;
  const push = (text: string, kind: JsonTokenKind | null) => {
    if (text) out.push({ text, kind });
  };

  for (const m of code.matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index;
    push(code.slice(last, start), null);

    let kind: JsonTokenKind;
    if (raw.startsWith('"')) {
      // 뒤에 콜론이 오면 key — 값 문자열과 색을 가른다.
      kind = /^\s*:/.test(code.slice(start + raw.length)) ? "key" : "string";
    } else if (raw === "true" || raw === "false") {
      kind = "boolean";
    } else if (raw === "null") {
      kind = "null";
    } else {
      kind = "number";
    }
    push(raw, kind);
    last = start + raw.length;
  }
  push(code.slice(last), null);

  return out;
}
