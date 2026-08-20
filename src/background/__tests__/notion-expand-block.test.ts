import { describe, expect, it } from "vitest";
import type { NotionBlock } from "@/types/notion";
import { expandBlock } from "../notion-api";

// Record<NotionBlock["type"], …>라 union에 타입이 추가되면 컴파일이 깨진다(타입 수준 래칫).
// 기대값은 SUT를 거치지 않은 손으로 쓴 리터럴이다.

const ATTACHMENTS = new Map<string, { fileUploadId: string; filename: string }>(
  [
    ["img-1", { fileUploadId: "UP-IMG", filename: "shot.png" }],
    ["vid-1", { fileUploadId: "UP-VID", filename: "clip.mp4" }],
  ],
);

interface ExpandCase {
  input: NotionBlock;
  expected: unknown;
}

const CASES: Record<NotionBlock["type"], ExpandCase> = {
  heading_2: {
    input: { type: "heading_2", text: "재현 절차" },
    expected: {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "재현 절차" } }],
      },
    },
  },
  heading_3: {
    input: { type: "heading_3", text: "환경" },
    expected: {
      object: "block",
      type: "heading_3",
      heading_3: { rich_text: [{ type: "text", text: { content: "환경" } }] },
    },
  },
  paragraph: {
    input: { type: "paragraph", text: "버튼이 반응하지 않음" },
    expected: {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: "버튼이 반응하지 않음" } }],
      },
    },
  },
  code: {
    input: { type: "code", language: "typescript", text: "const a = 1;" },
    expected: {
      object: "block",
      type: "code",
      code: {
        rich_text: [{ type: "text", text: { content: "const a = 1;" } }],
        language: "typescript",
      },
    },
  },
  bulleted_list_item: {
    input: { type: "bulleted_list_item", text: "첫 항목" },
    expected: {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [{ type: "text", text: { content: "첫 항목" } }],
      },
    },
  },
  numbered_list_item: {
    input: { type: "numbered_list_item", text: "1단계" },
    expected: {
      object: "block",
      type: "numbered_list_item",
      numbered_list_item: {
        rich_text: [{ type: "text", text: { content: "1단계" } }],
      },
    },
  },
  image: {
    input: { type: "image", placeholderId: "img-1" },
    expected: {
      object: "block",
      type: "image",
      image: { type: "file_upload", file_upload: { id: "UP-IMG" } },
    },
  },
  video: {
    input: { type: "video", placeholderId: "vid-1" },
    expected: {
      object: "block",
      type: "video",
      video: { type: "file_upload", file_upload: { id: "UP-VID" } },
    },
  },
  table: {
    input: {
      type: "table",
      rows: [
        ["항목", "값"],
        ["OS", "macOS"],
      ],
    },
    expected: {
      object: "block",
      type: "table",
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
        children: [
          {
            object: "block",
            type: "table_row",
            table_row: {
              cells: [
                [{ type: "text", text: { content: "항목" } }],
                [{ type: "text", text: { content: "값" } }],
              ],
            },
          },
          {
            object: "block",
            type: "table_row",
            table_row: {
              cells: [
                [{ type: "text", text: { content: "OS" } }],
                [{ type: "text", text: { content: "macOS" } }],
              ],
            },
          },
        ],
      },
    },
  },
  // 입력 type ≠ 출력 type: rich_paragraph → "paragraph"
  rich_paragraph: {
    input: {
      type: "rich_paragraph",
      richText: [
        {
          type: "text",
          text: { content: "굵게" },
          annotations: { bold: true, code: false },
        },
      ],
    },
    expected: {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: "굵게" },
            annotations: { bold: true, code: false },
          },
        ],
      },
    },
  },
  rich_bulleted_list_item: {
    input: {
      type: "rich_bulleted_list_item",
      richText: [
        {
          type: "text",
          text: { content: "링크", link: { url: "https://example.test/a" } },
        },
      ],
    },
    expected: {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: { content: "링크", link: { url: "https://example.test/a" } },
          },
        ],
      },
    },
  },
  rich_numbered_list_item: {
    input: {
      type: "rich_numbered_list_item",
      richText: [{ type: "text", text: { content: "평문" } }],
    },
    expected: {
      object: "block",
      type: "numbered_list_item",
      numbered_list_item: {
        rich_text: [{ type: "text", text: { content: "평문" } }],
      },
    },
  },
  // 입력 type ≠ 출력 type: rich_quote → "quote"
  rich_quote: {
    input: {
      type: "rich_quote",
      richText: [
        {
          type: "text",
          text: { content: "인용" },
          annotations: { italic: true },
        },
      ],
    },
    expected: {
      object: "block",
      type: "quote",
      quote: {
        rich_text: [
          {
            type: "text",
            text: { content: "인용" },
            annotations: { italic: true },
          },
        ],
      },
    },
  },
  // 입력 type ≠ 출력 type: mention_paragraph → "paragraph"
  mention_paragraph: {
    input: { type: "mention_paragraph", userIds: ["u1"] },
    expected: {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "cc " } },
          { type: "mention", mention: { user: { id: "u1" } } },
        ],
      },
    },
  },
  divider: {
    input: { type: "divider" },
    expected: { object: "block", type: "divider", divider: {} },
  },
};

describe("expandBlock — NotionBlock 15타입 전수", () => {
  it("테이블이 union 15멤버를 모두 든다", () => {
    expect(Object.keys(CASES)).toHaveLength(15);
  });

  it.each(Object.entries(CASES))("%s", (_type, { input, expected }) => {
    expect(expandBlock(input, ATTACHMENTS)).toEqual(expected);
  });
});

describe("expandBlock null 반환", () => {
  it("image는 attachmentMap에 placeholderId가 없으면 null", () => {
    expect(
      expandBlock({ type: "image", placeholderId: "없음" }, ATTACHMENTS),
    ).toBeNull();
  });

  it("video는 attachmentMap에 placeholderId가 없으면 null", () => {
    expect(
      expandBlock({ type: "video", placeholderId: "없음" }, ATTACHMENTS),
    ).toBeNull();
  });

  // table은 placeholder 축이 아니라 폭(rows[0].length) 축으로 null이 된다.
  it("table은 rows가 비면 null", () => {
    expect(expandBlock({ type: "table", rows: [] }, ATTACHMENTS)).toBeNull();
  });

  it("table은 첫 행이 빈 배열이면 null", () => {
    expect(expandBlock({ type: "table", rows: [[]] }, ATTACHMENTS)).toBeNull();
  });

  // 닫힌 union으로는 도달 불가한 default 분기.
  it("union 밖 type은 default로 null", () => {
    expect(expandBlock({ type: "bogus" } as never, new Map())).toBeNull();
  });
});

describe("expandBlock 세부 분기", () => {
  it("code의 language가 빈 문자열이면 'plain text'로 대체", () => {
    expect(
      expandBlock({ type: "code", language: "", text: "x" }, ATTACHMENTS),
    ).toEqual({
      object: "block",
      type: "code",
      code: {
        rich_text: [{ type: "text", text: { content: "x" } }],
        language: "plain text",
      },
    });
  });

  it("mention_paragraph는 사용자 2명 이상일 때만 ', ' 구분자를 넣는다", () => {
    expect(
      expandBlock(
        { type: "mention_paragraph", userIds: ["u1", "u2", "u3"] },
        ATTACHMENTS,
      ),
    ).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "cc " } },
          { type: "mention", mention: { user: { id: "u1" } } },
          { type: "text", text: { content: ", " } },
          { type: "mention", mention: { user: { id: "u2" } } },
          { type: "text", text: { content: ", " } },
          { type: "mention", mention: { user: { id: "u3" } } },
        ],
      },
    });
  });

  it("mention_paragraph는 userIds가 비면 'cc ' 텍스트만 남는다", () => {
    expect(
      expandBlock({ type: "mention_paragraph", userIds: [] }, ATTACHMENTS),
    ).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: "cc " } }],
      },
    });
  });

  it("paragraph의 text가 2000자를 넘으면 richText가 원소를 쪼갠다", () => {
    expect(
      expandBlock(
        { type: "paragraph", text: `${"a".repeat(2000)}b` },
        ATTACHMENTS,
      ),
    ).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "a".repeat(2000) } },
          { type: "text", text: { content: "b" } },
        ],
      },
    });
  });

  it("expandRichText는 link·annotations가 없으면 그 키를 만들지 않는다", () => {
    const out = expandBlock(
      {
        type: "rich_paragraph",
        richText: [{ type: "text", text: { content: "평문", link: null } }],
      },
      ATTACHMENTS,
    ) as unknown as { paragraph: { rich_text: Record<string, unknown>[] } };
    expect(out.paragraph.rich_text).toHaveLength(1);
    expect(Object.keys(out.paragraph.rich_text[0]!)).toEqual(["type", "text"]);
    expect(Object.keys(out.paragraph.rich_text[0]!.text as object)).toEqual([
      "content",
    ]);
  });
});
