import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

import { createMarkdownIt } from "../markdownIt";

describe("createMarkdownIt", () => {
  it("네 소비처가 공유하던 옵션 3종을 기본값으로 준다", () => {
    const md = createMarkdownIt();
    expect(md.options.html).toBe(false);
    expect(md.options.breaks).toBe(true);
    expect(md.options.linkify).toBe(true);
  });

  // 네 소비처가 전부 생성 직후 enable을 불렀다 — 팩토리가 안 켜면 넷 다 회귀한다.
  it("strikethrough를 켜서 돌려준다", () => {
    expect(createMarkdownIt().render("~~gone~~").trim()).toBe("<p><s>gone</s></p>");
  });

  it("옵션을 덧씌울 수 있다 (renderMarkdown의 highlight)", () => {
    const md = createMarkdownIt({ highlight: () => "<mark>hl</mark>" });
    expect(md.render("```\nx\n```")).toContain("<mark>hl</mark>");
  });

  // 렌더 결과가 dangerouslySetInnerHTML로 직행한다 — 호출부가 이 게이트를 못 덮어야 한다.
  it("호출부가 html 게이트를 덮을 수 없다", () => {
    const md = createMarkdownIt({ html: true });
    expect(md.options.html).toBe(false);
    expect(md.render("<script>x</script>")).not.toContain("<script>");
  });

  // 공유 인스턴스면 한 파일의 md.use()가 나머지 셋에 샌다.
  it("호출마다 새 인스턴스를 준다", () => {
    expect(createMarkdownIt()).not.toBe(createMarkdownIt());
  });
});

describe("MarkdownIt 설정 단일 출처", () => {
  it("생성·strikethrough 활성화가 팩토리 1곳에만 있다", () => {
    const files = walkSources(join(process.cwd(), "src"));
        const creators = files
      .filter((p) => /(?<![A-Za-z])MarkdownIt\(\{/.test(readFileSync(p, "utf8")))
      .map(relToRepo);
    const enablers = files
      .filter((p) => /enable\("strikethrough"\)/.test(readFileSync(p, "utf8")))
      .map(relToRepo);

    expect(creators).toEqual(["src/sidepanel/lib/markdownIt.ts"]);
    expect(enablers).toEqual(["src/sidepanel/lib/markdownIt.ts"]);
  });
});
