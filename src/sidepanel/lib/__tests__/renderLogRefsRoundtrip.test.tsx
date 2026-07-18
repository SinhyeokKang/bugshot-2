import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { appendLogBlocks } from "../renderLogRefs";
import { serializeConsoleEntry, serializeNetworkRequest } from "../logToCodeBlock";
import type { ConsoleEntry } from "@/types/console";
import type { NetworkRequest } from "@/types/network";

// dedup은 "동일 텍스트면 스킵"인데 prev 블록은 Tiptap 노드 → tiptap-markdown 직렬화를
// 거친 것이고 새 블록은 codeBlockMarkdown이 직접 만든 문자열이다 — fence 생성 주체가 다르다.
// codeBlockMarkdown 출력끼리 비교하는 테스트는 유닛만 green이고 실제 패널에서 재생성마다
// 블록이 늘어난다(PRD 목표 절). 그래서 여기서는 패널과 같은 확장 구성으로 실제 왕복본을 만든다.
function tiptapRoundtrip(markdown: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false, link: false }),
      Markdown.configure({ html: false, breaks: true }),
    ],
    content: markdown,
  });
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown(): string };
  };
  const out = storage.markdown.getMarkdown();
  editor.destroy();
  return out;
}

const CONSOLE_ENTRY: ConsoleEntry = {
  id: "cl-1700000000000-a",
  level: "error",
  timestamp: 0,
  args: "TypeError: Cannot read properties of undefined (reading 'pay')",
  stack:
    "TypeError: Cannot read properties of undefined (reading 'pay')\n    at checkout (https://example.com/app.js:10:5)",
  pageUrl: "https://example.com/checkout",
};

const NETWORK_REQ: NetworkRequest = {
  id: "nr-1700000000000-a",
  url: "https://example.com/api/pay",
  method: "POST",
  status: 500,
  statusText: "Internal Server Error",
  startTime: 0,
  durationMs: 50,
  requestHeaders: {},
  responseHeaders: {},
  requestBody: '{"amount":100}',
  responseBody: '{"error":"boom"}',
  pageUrl: "https://example.com/checkout",
  requestBodySize: 14,
  responseBodySize: 16,
  contentType: "application/json",
  phase: "complete",
};

describe("appendLogBlocks — Tiptap 왕복 후 dedup (재생성 시 블록 증식 방지)", () => {
  it.each([
    ["console 블록", () => serializeConsoleEntry(CONSOLE_ENTRY)],
    ["network(json) 블록", () => serializeNetworkRequest(NETWORK_REQ)],
  ])("%s: 왕복본 섹션에 같은 블록 재삽입 → 증식 없음", (_name, makeBlock) => {
    const block = makeBlock();
    const run1 = appendLogBlocks("AI가 쓴 산문", [block]);
    const roundTripped = tiptapRoundtrip(run1);
    const run2 = appendLogBlocks(roundTripped, [block]);
    // fence 개수로 판정 — 왕복이 개행·escape를 미세 조정해도 블록 수는 불변이어야 한다.
    const fenceCount = (md: string) => (md.match(/^`{3,}/gm) ?? []).length;
    expect(fenceCount(run2)).toBe(fenceCount(roundTripped));
  });
});
