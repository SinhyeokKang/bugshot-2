import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { BlockImage } from "../TiptapEditor";

// 본문에 넣은 인라인 이미지는 **블록 노드**다(`@tiptap/extension-image` 기본값).
// 그런데 tiptap-markdown은 그 노드에 prosemirror-markdown의 **인라인** 직렬화기를 꽂는다
// (`tiptap-markdown.es.js:414`). 인라인 직렬화기는 `state.closeBlock()`을 안 부르므로
// 블록 종료가 없고, 뒤따르는 블록이 그대로 이어 붙는다.
//
// 텍스트가 붙는 건 읽히기라도 하지만 리스트는 문단에 흡수돼 목록으로 렌더되지 않고
// 코드펜스는 깨진다. 이 본문이 8개 플랫폼과 클립보드 복사본으로 그대로 나간다.

function toMarkdown(html: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false, link: false }),
      BlockImage,
      Markdown,
    ],
    content: html,
  });
  const md = (
    editor.storage as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
  editor.destroy();
  return md;
}

describe("BlockImage — 이미지 뒤 블록 구분", () => {
  it("이미지 다음 문단이 붙지 않는다", () => {
    expect(toMarkdown('<img src="X"><p>hello</p>')).toBe("![](X)\n\nhello");
  });

  // 손상이 가장 큰 축 — 구분자가 없으면 `- a`가 문단에 흡수돼 목록이 아예 사라진다.
  it("이미지 다음 리스트가 목록으로 남는다", () => {
    expect(toMarkdown('<img src="X"><ul><li>a</li></ul>')).toBe("![](X)\n\n- a");
  });

  // 펜스 시작이 문단 안으로 들어가면 코드블럭이 통째로 깨진다.
  it("이미지 다음 코드블럭의 펜스가 깨지지 않는다", () => {
    expect(toMarkdown('<img src="X"><pre><code>c</code></pre>')).toBe(
      "![](X)\n\n```\nc\n```",
    );
  });

  it("이미지 두 장이 서로 붙지 않는다", () => {
    expect(toMarkdown('<img src="X"><img src="Y">')).toBe("![](X)\n\n![](Y)");
  });

  it("문단 사이에 낀 이미지도 양쪽이 갈린다", () => {
    expect(toMarkdown('<p>a</p><img src="X"><p>b</p>')).toBe("a\n\n![](X)\n\nb");
  });
});

// 원래 정상이던 두 형태. 이 경계가 없으면 closeBlock 대신 무조건 `\n\n`을 덧붙이는
// 구현이 통과하고, 본문 끝에 빈 줄이 쌓인다.
describe("BlockImage — 회귀 경계", () => {
  it("이미지 하나만 있으면 후행 개행이 붙지 않는다", () => {
    expect(toMarkdown('<img src="X">')).toBe("![](X)");
  });

  it("문단 다음 이미지는 종전과 같다", () => {
    expect(toMarkdown('<p>hello</p><img src="X">')).toBe("hello\n\n![](X)");
  });
});

// 직렬화기를 손으로 다시 쓰는 변경이라 이 축이 조용히 깨질 수 있다.
describe("BlockImage — alt·title 보존", () => {
  it("alt를 싣는다", () => {
    expect(toMarkdown('<img src="X" alt="a b">')).toBe("![a b](X)");
  });

  it("title을 싣는다", () => {
    expect(toMarkdown('<img src="X" alt="a" title="t">')).toBe('![a](X "t")');
  });
});
