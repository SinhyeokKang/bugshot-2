import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getLocale, setLocale } from "@/i18n";
import type { LocaleMode } from "@/i18n/locales";
import { VIDEO_PLACEHOLDER } from "@/lib/adf-sentinels";
import { buildJiraDescriptionContent } from "../messages";
import { expandPageBlocks } from "../notion-api";
import type { NotionCreatePagePayload } from "@/types/notion";
import {
  IMPORTS_WITH_LOCALE,
  exportedSegments,
  stripWithLocaleCalls,
} from "@/test/withLocaleScan";

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

// 헤더 라벨은 buildIssueAdf가 본문 언어로 찍는다 — 픽스처도 그 로케일을 따라야 한다.
// 영어로 박아두면 ko 본문에서 injectSnapshotRows가 table을 못 찾아 이 그물이 무음으로 죽는다.
const styleChangesTable = (asIs = "As is", toBe = "To be") => ({
  type: "table",
  content: [
    { type: "tableRow", content: [header("Property"), header(asIs), header(toBe)] },
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
      description: doc([paragraph(VIDEO_PLACEHOLDER), styleChangesTable("변경 전", "변경 후")]),
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

  // 사이드패널과 background 사이엔 chrome.runtime 메시지 경계가 하나 더 있고 그 게이트는
  // type만 본다. 오염값이 통과하면 locales[bad]가 undefined라 t()가 죽는데, 이 경로의 throw는
  // submitIssue의 try/catch가 삼켜서 placeholder 센티널이 남은 본문이 그대로 등록된다.
  it("오염된 bodyLocale은 화면 언어로 교정된다 (크래시 금지)", () => {
    setLocale("en");
    const content = buildJiraDescriptionContent({
      description: doc([paragraph(VIDEO_PLACEHOLDER)]),
      uploadMap: uploads({ "logs.html": "https://x/logs" }),
      bodyLocale: "jp" as LocaleMode,
    });
    expect(JSON.stringify(content)).toContain("(See attached recording)");
    expect(JSON.stringify(content)).not.toContain(VIDEO_PLACEHOLDER);
  });
});

describe("Notion 첨부 섹션 제목 — 빌더에 없고 background에서만 생성된다", () => {
  const payload = (bodyLocale?: LocaleMode): NotionCreatePagePayload => ({
    databaseId: "db",
    title: "T",
    titlePropertyName: "Name",
    selectValues: [],
    blocks: [],
    attachments: [
      { placeholderId: "p1", fileUploadId: "f1", filename: "logs.html", category: "log" },
    ],
    bodyLocale,
  });

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

  it("오염된 bodyLocale은 화면 언어로 교정된다 (크래시 금지)", () => {
    setLocale("en");
    expect(JSON.stringify(expandPageBlocks(payload("jp" as LocaleMode)))).toContain(
      "Attachments",
    );
  });
});

// 사이드패널 빌더는 builderLocaleWrap.test.ts가 래핑 누락을 red로 만들지만 background엔 그
// 등가 그물이 없었다. 새 어댑터가 제출 후처리에서 본문 문자열을 찍으면 무음으로 화면 언어가
// 샌다 — 본문으로 나가는 키를 화이트리스트로 고정해, 넷째 키가 생기면 래핑을 강제한다.
describe("background 본문 문자열 게이트", () => {
  const BG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
  // 이슈 본문을 **만들거나 본문과 대조하는** 키. 출력 여부가 아니라 로케일이 갈리면 무음으로
  // 실패하는가가 기준이다 — `styleTable.asIs`/`toBe`는 본문에 안 찍히고 injectSnapshotRows의
  // 표 식별 입력으로만 쓰이지만, 본문을 만든 로케일과 어긋나면 Snapshot 행이 조용히 빠진다.
  // 나머지(플랫폼 라벨·에러 문구)는 화면 언어가 정답이다.
  // `attachmentSection`은 플랫폼 접두 키라 접두사만 보면 asana.·clickup. 복제가 새므로
  // 접미로 잡고, 로그 요약(`logSummary.`)은 아직 background에 없지만 빌더가 쓰는 본문
  // 네임스페이스라 미리 편입한다 — 여기 없는 네임스페이스는 곧 무음 통과다.
  const BODY_KEY = /(^(md|styleTable|logSummary)\.|\.attachmentSection$)/;

  interface BgFile {
    file: string;
    source: string;
    keys: string[];
  }

  function collect(dir: string, prefix = ""): BgFile[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) {
        return e.name === "__tests__" ? [] : collect(join(dir, e.name), `${prefix}${e.name}/`);
      }
      if (!e.name.endsWith(".ts")) return [];
      const source = readFileSync(join(dir, e.name), "utf8");
      // `set(`·`get(` 같은 접미 일치를 배제하려고 t 앞의 식별자·점을 막는다. 백틱도 받는다
      // (같은 저장소에 `t(`템플릿`)` 선례가 있다 — prepareUpload.ts).
      const keys = [...source.matchAll(/(?<![\w.])t\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
      return [{ file: `${prefix}${e.name}`, source, keys }];
    });
  }

  const scanned = collect(BG_DIR);
  const allKeys = scanned.flatMap((f) => f.keys);
  const bodyKeys = [...new Set(allKeys.filter((k) => BODY_KEY.test(k)))].sort();

  // 정규식이나 경로가 깨지면 bodyKeys가 빈 배열이라 아래가 공허해진다. 하위 디렉터리 파일을
  // 명시해 재귀 소실까지 고정한다 — 개수 하한만 두면 33→31 같은 부분 소실이 묻힌다.
  it("스캔이 background 소스에 도달한다 (자기검증 앵커)", () => {
    expect(scanned.length).toBeGreaterThan(5);
    expect(allKeys.length).toBeGreaterThan(30);
    expect(allKeys).toContain("jira.error.401");
    expect(scanned.some((f) => f.file.includes("/"))).toBe(true);
  });

  it("본문을 만들거나 대조하는 t() 키는 래핑된 다섯뿐이다", () => {
    expect(bodyKeys).toEqual([
      "md.videoAttached",
      "notion.attachmentSection",
      "styleTable.asIs",
      "styleTable.snapshot",
      "styleTable.toBe",
    ]);
  });

  const owners = scanned.filter((f) => f.keys.some((k) => BODY_KEY.test(k)));

  it("그 키들을 담은 파일은 withLocale을 import한다", () => {
    expect(owners.map((f) => f.file).sort()).toEqual(["messages.ts", "notion-api.ts"]);
    for (const owner of owners) {
      expect(owner.source, owner.file).toMatch(IMPORTS_WITH_LOCALE);
    }
  });

  // 키 목록만 보면 **이미 목록에 있는 키를 owner 파일 안에서 한 번 더** 쓰는 형태가 무음이다
  // (Set dedupe라 bodyKeys도 owners도 안 변한다). 같은 문단을 다른 핸들러가 재사용하는 게
  // 이 realm의 자연스러운 재발 형태라, 사이드패널과 같은 스캐너로 래퍼 안팎을 본다.
  // 사이드패널과 같은 이유로 export 선언만 본다 — 비-export 헬퍼(`snapshotRow`)의 본문 키는
  // 텍스트상 래퍼 밖이지만 호출부가 래핑 구간 안이라 정상이다.
  it("export 진입점의 본문 키가 전부 래퍼 안에 있다", () => {
    for (const owner of owners) {
      const outside = exportedSegments(owner.source).flatMap((s) =>
        [...stripWithLocaleCalls(s.body).matchAll(/(?<![\w.])t\(\s*["'`]([^"'`]+)["'`]/g)]
          .map((m) => m[1])
          .filter((k) => BODY_KEY.test(k)),
      );
      expect(outside, owner.file).toEqual([]);
    }
  });
});
