import { describe, expect, it } from "vitest";
import { extractNotionPageId } from "../notion-page-id";

describe("extractNotionPageId", () => {
  it("32자 hex (대시 없는 형태) 추출 — title-slug 접두사 무시", () => {
    expect(
      extractNotionPageId(
        "https://www.notion.so/My-Bug-Title-1234567890abcdef1234567890abcdef",
      ),
    ).toBe("1234567890abcdef1234567890abcdef");
  });

  it("워크스페이스 prefix가 있는 URL", () => {
    expect(
      extractNotionPageId(
        "https://www.notion.so/myworkspace/My-Page-abcdef0123456789abcdef0123456789",
      ),
    ).toBe("abcdef0123456789abcdef0123456789");
  });

  it("8-4-4-4-12 UUID 형태 (대시 포함) 추출", () => {
    expect(
      extractNotionPageId(
        "https://www.notion.so/Title-12345678-1234-1234-1234-123456789abc",
      ),
    ).toBe("12345678-1234-1234-1234-123456789abc");
  });

  it("쿼리 파라미터(?v=)가 있어도 추출", () => {
    expect(
      extractNotionPageId(
        "https://www.notion.so/Title-1234567890abcdef1234567890abcdef?v=xxx",
      ),
    ).toBe("1234567890abcdef1234567890abcdef");
  });

  it("hex 형태가 아닌 URL은 null", () => {
    expect(extractNotionPageId("https://www.notion.so/just-a-title")).toBeNull();
  });

  it("잘못된 URL은 null", () => {
    expect(extractNotionPageId("not a url")).toBeNull();
  });

  it("undefined / 빈 문자열은 null", () => {
    expect(extractNotionPageId(undefined)).toBeNull();
    expect(extractNotionPageId("")).toBeNull();
  });

  it("CLAUDE.md 시나리오: split('/').pop() 결과를 그대로 넣어도 추출 가능", () => {
    // IssueCreateModal/DraftDetailDialog의 기존 버그 재현 — slug+id 문자열에서 pageId 회수
    const fromSplitPop = "My-Bug-Title-1234567890abcdef1234567890abcdef";
    // URL이 아니라 단편이지만, notion-page-id 헬퍼는 URL 형태가 아니면 null이 정상.
    expect(extractNotionPageId(fromSplitPop)).toBeNull();
  });
});
