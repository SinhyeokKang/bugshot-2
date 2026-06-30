import { describe, it, expect } from "vitest";
import type { Editor } from "@tiptap/react";
import { editorMarkdown } from "../TiptapEditor";

// editor.storage만 의존하는 준순수 헬퍼. tiptap Editor 전체 대신 storage 형태만 모킹.
const makeEditor = (md: string | null): Editor =>
  ({
    storage: md === null ? {} : { markdown: { getMarkdown: () => md } },
  }) as unknown as Editor;

describe("editorMarkdown", () => {
  it("markdown storage가 없으면 빈 문자열을 반환한다 (stale editor 접근 방어)", () => {
    expect(editorMarkdown(makeEditor(null), new Map())).toBe("");
  });

  it("storage.markdown.getMarkdown() 결과를 그대로 반환한다", () => {
    expect(editorMarkdown(makeEditor("hello world"), new Map())).toBe("hello world");
  });

  it("urlToRef 매핑으로 blob URL을 inline:refId로 치환한다", () => {
    const map = new Map([["blob:abc", "ref1"]]);
    expect(editorMarkdown(makeEditor("img blob:abc end"), map)).toBe("img inline:ref1 end");
  });
});
