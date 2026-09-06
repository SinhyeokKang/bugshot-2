import { describe, expect, it } from "vitest";

import { escapeMrkdwn, markdownToMrkdwn } from "../markdownToMrkdwn";

// Slack mrkdwn은 마크다운과 문법이 다르다(볼드 `*`, 이탤릭 `_`, 링크 `<url|text>`,
// 헤딩 없음, 인라인 이미지 없음). 변환 규칙은 design.md "변환 규칙표" 기준.

describe("markdownToMrkdwn — 인라인 마크", () => {
  it("**bold** → *bold*", () => {
    expect(markdownToMrkdwn("**bold**")).toBe("*bold*");
  });

  it("*italic* / _italic_ → _italic_", () => {
    expect(markdownToMrkdwn("*italic*")).toBe("_italic_");
    expect(markdownToMrkdwn("_italic_")).toBe("_italic_");
  });

  it("~~strike~~ → ~strike~", () => {
    expect(markdownToMrkdwn("~~strike~~")).toBe("~strike~");
  });

  it("[text](url) → <url|text>", () => {
    expect(markdownToMrkdwn("[Google](https://google.com)")).toBe(
      "<https://google.com|Google>",
    );
  });

  it("![alt](url) 인라인 이미지는 제거 (Slack mrkdwn 미지원, 첨부로 분리)", () => {
    expect(markdownToMrkdwn("![shot](https://x/y.png)")).not.toContain("y.png");
    expect(markdownToMrkdwn("![shot](https://x/y.png)")).not.toContain("![");
  });
});

describe("markdownToMrkdwn — 블록", () => {
  it("# / ## 헤딩 → 볼드 줄 (mrkdwn 헤딩 문법 없음)", () => {
    expect(markdownToMrkdwn("# Title")).toBe("*Title*");
    expect(markdownToMrkdwn("## Sub")).toBe("*Sub*");
  });

  it("- item / * item 불릿 → • item", () => {
    expect(markdownToMrkdwn("- first")).toBe("• first");
    expect(markdownToMrkdwn("* second")).toBe("• second");
  });

  it("1. item 순서 리스트는 그대로 유지", () => {
    expect(markdownToMrkdwn("1. first")).toBe("1. first");
  });

  it("> quote는 그대로 유지 (mrkdwn 지원)", () => {
    expect(markdownToMrkdwn("> note")).toBe("> note");
  });

  it("코드블록 내부는 변환하지 않는다 (``` 보존)", () => {
    const md = "```\n**not bold**\n```";
    const out = markdownToMrkdwn(md);
    expect(out).toContain("**not bold**");
    expect(out).toContain("```");
  });

  it("인라인 `code`는 그대로 유지", () => {
    expect(markdownToMrkdwn("`x`")).toBe("`x`");
  });
});

describe("markdownToMrkdwn — 엣지", () => {
  it("빈 문자열 → 빈 문자열", () => {
    expect(markdownToMrkdwn("")).toBe("");
  });

  it("일반 텍스트는 변경 없음", () => {
    expect(markdownToMrkdwn("hello world")).toBe("hello world");
  });

  it("CommonMark hard break의 백슬래시는 Slack 본문에 노출하지 않는다", () => {
    expect(markdownToMrkdwn("정상 동작\\\n실패 시 오류 안내")).toBe(
      "정상 동작\n실패 시 오류 안내",
    );
  });

  it("줄 끝의 짝수 개 백슬래시는 리터럴로 보존한다", () => {
    expect(markdownToMrkdwn("경로 C:\\\\\n다음 줄")).toBe("경로 C:\\\\\n다음 줄");
  });

  it("문서 끝의 백슬래시는 hard break가 아니므로 보존한다", () => {
    expect(markdownToMrkdwn("경로 C:\\")).toBe("경로 C:\\");
  });
});

describe("escapeMrkdwn — 특수문자 이스케이프", () => {
  it("< > & → &lt; &gt; &amp;", () => {
    expect(escapeMrkdwn("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
  });

  it("셀렉터 div.foo > span 같은 입력을 안전하게 이스케이프", () => {
    expect(escapeMrkdwn("div > span")).toBe("div &gt; span");
  });

  it("특수문자 없으면 원본 그대로", () => {
    expect(escapeMrkdwn("plain text")).toBe("plain text");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(escapeMrkdwn("")).toBe("");
  });
});

describe("markdownToMrkdwn — fence 판정은 CommonMark 들여쓰기 규칙(≤3)을 따른다", () => {
  it("4칸 이상 들여쓴 백틱 런은 fence를 열지 않는다 (코드블럭 본문의 무해화된 백틱)", () => {
    const md = ["```", "before", "    ```", "*keep*", "```"].join("\n");

    // 무해화된 라인이 fence를 토글하면 그 뒤 로그 본문이 convertInline을 타서 변형된다.
    expect(markdownToMrkdwn(md)).toBe(md);
  });

  it("들여쓰기 0~3칸 백틱은 기존대로 fence로 인식", () => {
    const md = ["  ```", "code", "  ```", "*bold*"].join("\n");

    expect(markdownToMrkdwn(md)).toBe(["  ```", "code", "  ```", "_bold_"].join("\n"));
  });
});

/* ------------------------------------------------------------------ */
/*  이미지 제거가 남기는 빈 줄                                           */
/* ------------------------------------------------------------------ */

// Slack만 이미지를 placeholder로 바꾸지 않고 통째로 지운다(다른 경로는 stripInlineImageRefs가
// 지운 뒤 빈 줄까지 접는다). 이미지가 블록으로 직렬화되면서 이미지 줄이 통째로 사라지는데,
// 그 자리를 빈 줄로 남기면 Slack 메시지에 세로 여백만 쌓인다.
describe("markdownToMrkdwn — 이미지 제거 후 빈 줄", () => {
  it("이미지 블록 뒤 문단이 앞으로 당겨진다", () => {
    expect(markdownToMrkdwn("![](inline:x)\n\nhello")).toBe("hello");
  });

  it("문단 사이에 낀 이미지는 문단 구분 한 줄만 남긴다", () => {
    expect(markdownToMrkdwn("a\n\n![](inline:x)\n\nb")).toBe("a\n\nb");
  });

  it("이미지 두 장이 연속이어도 빈 줄이 쌓이지 않는다", () => {
    expect(markdownToMrkdwn("![](inline:x)\n\n![](inline:y)\n\nhello")).toBe("hello");
  });

  it("이미지 뒤 리스트도 앞으로 당겨진다", () => {
    expect(markdownToMrkdwn("![](inline:x)\n\n- a")).toBe("• a");
  });

  // 이미지와 무관한 문단 구분은 그대로여야 한다 — 무조건 접으면 본문이 뭉친다.
  it("일반 문단 구분은 보존한다", () => {
    expect(markdownToMrkdwn("a\n\nb")).toBe("a\n\nb");
  });

  // 코드블럭 안의 빈 줄은 내용이다.
  it("코드블럭 내부 빈 줄은 접지 않는다", () => {
    expect(markdownToMrkdwn("```\na\n\n\nb\n```")).toBe("```\na\n\n\nb\n```");
  });
});

// 이미지 제거 자리를 접는 로직이 건드리는 나머지 경계. 접기·후행 제거 어느 쪽도
// 뮤테이션으로 지웠을 때 red가 떠야 한다.
describe("markdownToMrkdwn — 빈 줄 정리 경계", () => {
  it("본문 끝 빈 줄을 남기지 않는다", () => {
    expect(markdownToMrkdwn("hello\n\n")).toBe("hello");
  });

  it("본문 앞 빈 줄을 남기지 않는다", () => {
    expect(markdownToMrkdwn("\n\nhello")).toBe("hello");
  });

  // 공백만 있는 줄도 빈 줄이다 — 정확 일치로 판정하면 들여쓴 이미지가 남긴 공백이 새어나간다.
  it("공백만 있는 줄은 빈 줄로 접는다", () => {
    expect(markdownToMrkdwn("a\n\n   \n\nb")).toBe("a\n\nb");
  });

  it("들여쓴 이미지도 빈 줄을 남기지 않는다", () => {
    expect(markdownToMrkdwn("a\n\n  ![x](u)  \n\nb")).toBe("a\n\nb");
  });

  // 닫히지 않은 fence 안은 전부 내용이다 — 후행 제거가 거기까지 손대면 코드가 잘린다.
  it("닫히지 않은 코드블럭의 끝 빈 줄은 자르지 않는다", () => {
    expect(markdownToMrkdwn("text\n\n```js\nconst a = 1;\n\n")).toBe(
      "text\n\n```js\nconst a = 1;\n\n",
    );
  });

  it("닫힌 코드블럭 뒤 빈 줄은 정리한다", () => {
    expect(markdownToMrkdwn("```\na\n```\n\n")).toBe("```\na\n```");
  });
});
