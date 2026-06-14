import { describe, it, expect } from "vitest";
import {
  CC_SENTINEL,
  ccMarkdownLine,
  ccAdfParagraph,
  ccAsanaHtml,
  injectAsanaCc,
} from "../ccMention";

describe("ccMarkdownLine", () => {
  it("핸들 2개를 쉼표로 구분해 cc 줄을 만든다", () => {
    expect(ccMarkdownLine(["a", "b"])).toBe("cc @a, @b");
  });

  it("핸들 1개면 쉼표 없이 만든다", () => {
    expect(ccMarkdownLine(["alice"])).toBe("cc @alice");
  });

  it("빈 배열이면 빈 문자열을 반환한다", () => {
    expect(ccMarkdownLine([])).toBe("");
  });

  it("공백 포함 이름은 그대로 유지한다 (쉼표가 경계)", () => {
    expect(ccMarkdownLine(["Jane Doe", "Kim Min"])).toBe(
      "cc @Jane Doe, @Kim Min",
    );
  });

  it("마크다운 특수문자를 백슬래시로 이스케이프한다", () => {
    expect(ccMarkdownLine(["a_b", "x[y]", "c*d"])).toBe(
      "cc @a\\_b, @x\\[y\\], @c\\*d",
    );
  });

  it("< > 도 이스케이프한다 (raw 마크업 이름 방지)", () => {
    expect(ccMarkdownLine(["<img>"])).toBe("cc @\\<img\\>");
  });

  it("escape:false면 그대로 둔다 (GitHub/GitLab username용)", () => {
    expect(ccMarkdownLine(["a_b", "c.d"], { escape: false })).toBe(
      "cc @a_b, @c.d",
    );
  });
});

describe("CC_SENTINEL", () => {
  it("마크다운 활성 문자를 포함하지 않는다 (참조 정의·linkify에 면역)", () => {
    expect(CC_SENTINEL).toMatch(/^[A-Z-]+$/);
  });
});

describe("ccAdfParagraph", () => {
  it('"cc " 텍스트 + 멘션 노드 + 사이 ", " 텍스트로 paragraph를 만든다', () => {
    expect(
      ccAdfParagraph([
        { accountId: "id1", displayName: "Alice" },
        { accountId: "id2", displayName: "Bob" },
      ]),
    ).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "cc " },
        { type: "mention", attrs: { id: "id1", text: "@Alice" } },
        { type: "text", text: ", " },
        { type: "mention", attrs: { id: "id2", text: "@Bob" } },
      ],
    });
  });

  it("1명이면 구분 텍스트 없이 멘션 노드 하나만 넣는다", () => {
    expect(
      ccAdfParagraph([{ accountId: "id1", displayName: "Alice" }]),
    ).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "cc " },
        { type: "mention", attrs: { id: "id1", text: "@Alice" } },
      ],
    });
  });

  it("빈 배열이면 null을 반환한다", () => {
    expect(ccAdfParagraph([])).toBeNull();
  });
});

describe("ccAsanaHtml", () => {
  it("gid별 앵커를 쉼표로 구분해 cc HTML을 만든다", () => {
    expect(ccAsanaHtml([{ gid: "111" }, { gid: "222" }])).toBe(
      'cc <a data-asana-gid="111"/>, <a data-asana-gid="222"/>',
    );
  });

  it("1명이면 앵커 하나만 넣는다", () => {
    expect(ccAsanaHtml([{ gid: "111" }])).toBe(
      'cc <a data-asana-gid="111"/>',
    );
  });
});

describe("injectAsanaCc", () => {
  it("html 내 sentinel을 앵커 cc HTML로 치환한다", () => {
    const html = `<body><p>본문</p><p>${CC_SENTINEL}</p></body>`;
    expect(injectAsanaCc(html, [{ gid: "111" }, { gid: "222" }])).toBe(
      '<body><p>본문</p><p>cc <a data-asana-gid="111"/>, <a data-asana-gid="222"/></p></body>',
    );
  });

  it("users가 비어 있으면 sentinel만 제거한다", () => {
    const html = `<body><p>${CC_SENTINEL}</p></body>`;
    expect(injectAsanaCc(html, [])).toBe("<body><p></p></body>");
  });

  it("sentinel이 없는 html은 그대로 반환한다", () => {
    const html = "<body><p>본문</p></body>";
    expect(injectAsanaCc(html, [{ gid: "111" }])).toBe(html);
  });

  it("사용자가 본문에 입력한 동일 문자열이 있어도 마지막(빌더) sentinel만 치환한다", () => {
    const html = `<body><p>${CC_SENTINEL} 언급한 본문</p><p>${CC_SENTINEL}</p></body>`;
    expect(injectAsanaCc(html, [{ gid: "111" }])).toBe(
      `<body><p>${CC_SENTINEL} 언급한 본문</p><p>cc <a data-asana-gid="111"/></p></body>`,
    );
  });
});
