import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocale, setLocale } from "@/i18n";
import { VIDEO_PLACEHOLDER } from "@/lib/adf-sentinels";
import { buildJiraDescriptionContent } from "../messages";
import { expandPageBlocks } from "../notion-api";
import type { NotionCreatePagePayload } from "@/types/notion";

// background는 currentLocale 인스턴스가 사이드패널과 별도다(bg-init이 화면 언어로 세팅).
// 사이드패널의 withLocale이 여기 닿지 않으므로 제출 payload에 bodyLocale을 실어 전달하고
// 이 realm에서 다시 감싼다. 안 하면 영어 본문 안에 한국어 한 줄이 섞인다.
beforeEach(() => setLocale("ko"));
afterEach(() => setLocale("ko"));

type UploadEntry = { kind: "external"; url: string };
const uploads = (entries: Record<string, string>) =>
  new Map<string, UploadEntry>(
    Object.entries(entries).map(([name, url]) => [name, { kind: "external", url }]),
  );

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const header = (text: string) => ({
  type: "tableHeader",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const styleChangesTable = () => ({
  type: "table",
  content: [
    { type: "tableRow", content: [header("Property"), header("As is"), header("To be")] },
    { type: "tableRow", content: [{ type: "tableCell", content: [] }] },
  ],
});

const doc = (content: unknown[]) => ({ version: 1 as const, type: "doc" as const, content });

describe("Jira 본문 — background 생성 문자열", () => {
  // 영상이 media로 안 붙었을 때 placeholder를 대체하는 문단.
  it("bodyLocale en이면 영상 폴백 문단이 영어다", () => {
    const content = buildJiraDescriptionContent({
      description: doc([paragraph(VIDEO_PLACEHOLDER)]),
      uploadMap: uploads({ "logs.html": "https://x/logs" }),
      bodyLocale: "en",
    });
    expect(JSON.stringify(content)).toContain("(See attached recording)");
    expect(JSON.stringify(content)).not.toContain("(첨부 녹화 파일 참조)");
  });

  // 같은 키를 Linear·ClickUp·Markdown은 빌더 안에서 찍는데 Jira만 background다.
  it("bodyLocale en이면 스냅샷 행 라벨이 영어다", () => {
    const content = buildJiraDescriptionContent({
      description: doc([styleChangesTable()]),
      uploadMap: uploads({ "before-0.webp": "https://x/b", "after-0.webp": "https://x/a" }),
      bodyLocale: "en",
    });
    expect(JSON.stringify(content)).toContain("Snapshot");
    expect(JSON.stringify(content)).not.toContain("스냅샷");
  });

  it("bodyLocale ko면 두 문자열 모두 한국어다 (기본값 파리티)", () => {
    const content = buildJiraDescriptionContent({
      description: doc([paragraph(VIDEO_PLACEHOLDER), styleChangesTable()]),
      uploadMap: uploads({ "before-0.webp": "https://x/b", "after-0.webp": "https://x/a" }),
      bodyLocale: "ko",
    });
    const json = JSON.stringify(content);
    expect(json).toContain("(첨부 녹화 파일 참조)");
    expect(json).toContain("스냅샷");
  });

  // 구버전 사이드패널이 보낸 메시지엔 이 필드가 없다 — 크래시 대신 화면 언어로 떨어져야 한다.
  it("bodyLocale 누락 시 background 화면 언어로 폴백한다", () => {
    setLocale("en");
    const content = buildJiraDescriptionContent({
      description: doc([paragraph(VIDEO_PLACEHOLDER)]),
      uploadMap: uploads({ "logs.html": "https://x/logs" }),
    });
    expect(JSON.stringify(content)).toContain("(See attached recording)");
  });

  it("호출 후 background 로케일이 복원된다", () => {
    setLocale("ko");
    buildJiraDescriptionContent({
      description: doc([paragraph(VIDEO_PLACEHOLDER)]),
      uploadMap: uploads({ "logs.html": "https://x/logs" }),
      bodyLocale: "en",
    });
    expect(getLocale()).toBe("ko");
  });
});

describe("Notion 첨부 섹션 제목 — 빌더에 없고 background에서만 생성된다", () => {
  const payload = (bodyLocale?: "ko" | "en"): NotionCreatePagePayload =>
    ({
      databaseId: "db",
      title: "T",
      titlePropertyName: "Name",
      selectValues: [],
      blocks: [],
      attachments: [
        { placeholderId: "p1", fileUploadId: "f1", filename: "logs.html", category: "log" },
      ],
      ...(bodyLocale ? { bodyLocale } : {}),
    }) as NotionCreatePagePayload;

  it("bodyLocale en이면 첨부 섹션 제목이 영어다", () => {
    const blocks = expandPageBlocks(payload("en"));
    expect(JSON.stringify(blocks)).toContain("Attachments");
    expect(JSON.stringify(blocks)).not.toContain("첨부");
  });

  it("bodyLocale ko면 한국어다 (기본값 파리티)", () => {
    const blocks = expandPageBlocks(payload("ko"));
    expect(JSON.stringify(blocks)).toContain("첨부");
  });

  it("bodyLocale 누락 시 background 화면 언어로 폴백한다", () => {
    setLocale("en");
    expect(JSON.stringify(expandPageBlocks(payload()))).toContain("Attachments");
  });

  it("호출 후 background 로케일이 복원된다", () => {
    setLocale("ko");
    expandPageBlocks(payload("en"));
    expect(getLocale()).toBe("ko");
  });
});
