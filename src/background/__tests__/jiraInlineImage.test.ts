import { describe, it, expect } from "vitest";
import { inlineImagePlaceholder } from "@/lib/adf-sentinels";
import { inlineUploadFilename } from "@/lib/inline-ref";
import { buildJiraDescriptionContent } from "../messages";

// 인라인 이미지 업로드 파일명은 사이드패널(submitToJira)이 만들고 여기 background가 조회한다 —
// realm이 갈려 타입이 못 잇는 유일한 짝이라, 한쪽이 문자열을 다시 조립하면 무음으로 갈린다.
// 그래서 조회 키를 헬퍼가 아니라 **리터럴**로 적는다: 헬퍼 반환값이 바뀌면 이 테스트가 red다.
type UploadEntry = { kind: "external"; url: string };
const uploads = (entries: Record<string, string>) =>
  new Map<string, UploadEntry>(
    Object.entries(entries).map(([name, url]) => [name, { kind: "external", url }]),
  );

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const doc = (content: unknown[]) => ({ version: 1 as const, type: "doc" as const, content });

describe("Jira 본문 — 인라인 이미지 placeholder 치환", () => {
  it("업로드된 inline-<refId>.webp를 찾아 media로 바꾼다", () => {
    const content = buildJiraDescriptionContent({
      description: doc([paragraph(inlineImagePlaceholder("r1"))]),
      uploadMap: uploads({ "inline-r1.webp": "https://x/r1.webp" }),
      bodyLocale: "ko",
    });

    expect((content[0] as { type: string }).type).toBe("mediaSingle");
    expect(JSON.stringify(content)).toContain("https://x/r1.webp");
  });

  // 생성 측이 쓰는 이름과 조회 키가 같은 함수에서 나오는지 — 둘이 갈리면 아래가 깨진다.
  it("조회 키가 inlineUploadFilename의 산출과 일치한다", () => {
    expect(inlineUploadFilename("r1")).toBe("inline-r1.webp");
  });

  // 업로드가 누락된 refId는 문단을 그대로 둔다(이미지 없이 본문만 나간다).
  it("업로드에 없는 refId면 placeholder 문단을 그대로 남긴다", () => {
    const content = buildJiraDescriptionContent({
      description: doc([paragraph(inlineImagePlaceholder("missing"))]),
      uploadMap: uploads({ "inline-r1.webp": "https://x/r1.webp" }),
      bodyLocale: "ko",
    });

    expect((content[0] as { type: string }).type).toBe("paragraph");
  });
});
