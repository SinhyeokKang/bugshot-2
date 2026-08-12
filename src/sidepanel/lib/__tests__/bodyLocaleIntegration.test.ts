import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// **이 파일은 `vi.mock("@/i18n")`을 두지 않는다.** 빌더 테스트 20개는 전부 @/i18n을 모킹하고
// mock t가 키를 그대로 에코하므로 로케일이 출력에 반영될 여지가 0이다 — 골든 62장이 무수정
// 통과해도 bodyLocale 배선이 완전히 틀렸을 수 있다. 실사전을 쓰는 이 파일이 이 축의 유일한 그물.
//
// inline 이미지 resolve만 외부 의존(IndexedDB)이라 모킹한다.
vi.mock("../resolveInlineImages", () => ({
  extractInlineRefs: () => [],
  resolveInlineImages: vi.fn(async (markdown: string) => ({ resolved: markdown, images: [] })),
  resolveSectionImages: vi.fn(async (sections: Record<string, string>) => ({ ...sections })),
}));

import { getLocale, setLocale } from "@/i18n";
import { useSettingsUiStore, type IssueSection } from "@/store/settings-ui-store";
import { buildIssueAdf } from "../buildIssueAdf";
import { buildAsanaIssueBody } from "../buildAsanaIssueBody";
import { buildClickupIssueBody } from "../buildClickupIssueBody";
import { buildGithubIssueBody } from "../buildGithubIssueBody";
import { buildGitlabIssueBody } from "../buildGitlabIssueBody";
import { buildIssueHtml, buildIssueMarkdown, type MarkdownContext } from "../buildIssueMarkdown";
import { buildLinearIssueBody } from "../buildLinearIssueBody";
import { buildMarkdownIssueBody } from "../buildMarkdownIssueBody";
import { buildNotionIssueBody } from "../buildNotionIssueBody";
import { buildReportData, deriveContextEnvRows } from "../buildReportData";
import { buildSlackBody } from "../buildSlackBody";
import type { LocaleMode } from "@/i18n/locales";

const sectionConfig: IssueSection[] = [
  { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
  { id: "media", enabled: true, renderAs: "meta", builtIn: true },
  { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
];

function makeCtx(bodyLocale: LocaleMode, overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    bodyLocale,
    captureMode: "screenshot",
    title: "T",
    os: "macOS",
    browser: "Chrome",
    sections: { description: "사용자가 쓴 본문", stepsToReproduce: "1단계", expectedResult: "기대" },
    sectionConfig,
    url: "https://example.com",
    selector: "",
    tagName: "",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 800, height: 600 },
    capturedAt: 1_700_000_000_000,
    diffs: [],
    environment: [],
    ...overrides,
  };
}

// 11개 진입점 — 9개 빌더 함수 + 위임 어댑터 2개(github·gitlab). 위임 대상이 감싸지면 따라온다.
const BUILDERS: { name: string; run: (ctx: MarkdownContext) => unknown }[] = [
  { name: "buildIssueMarkdown", run: (ctx) => buildIssueMarkdown(ctx) },
  { name: "buildIssueHtml", run: (ctx) => buildIssueHtml(ctx) },
  { name: "buildIssueAdf", run: (ctx) => buildIssueAdf(ctx) },
  { name: "buildMarkdownIssueBody", run: (ctx) => buildMarkdownIssueBody({ ctx }, { platform: "github" }) },
  { name: "buildGithubIssueBody", run: (ctx) => buildGithubIssueBody({ ctx }) },
  { name: "buildGitlabIssueBody", run: (ctx) => buildGitlabIssueBody({ ctx }) },
  { name: "buildNotionIssueBody", run: (ctx) => buildNotionIssueBody({ ctx }) },
  { name: "buildLinearIssueBody", run: (ctx) => buildLinearIssueBody({ ctx }) },
  { name: "buildAsanaIssueBody", run: (ctx) => buildAsanaIssueBody({ ctx }) },
  { name: "buildClickupIssueBody", run: (ctx) => buildClickupIssueBody({ ctx }) },
  { name: "buildSlackBody", run: (ctx) => buildSlackBody({ ctx }) },
];

const serialize = (out: unknown) => JSON.stringify(out);

beforeEach(() => {
  setLocale("ko");
});

afterEach(() => {
  setLocale("ko");
});

describe("본문 언어 — 실사전 통합 (화면 ko + bodyLocale en)", () => {
  it("스윕 대상이 11개 진입점이다 (자기검증 앵커)", () => {
    expect(BUILDERS).toHaveLength(11);
  });

  it.each(BUILDERS.map((b) => b.name))("%s — 헤딩이 영어로 나간다", (name) => {
    const builder = BUILDERS.find((b) => b.name === name)!;
    const out = serialize(builder.run(makeCtx("en")));
    expect(out).toContain("Environment");
    expect(out).not.toContain("재현 환경");
  });

  it.each(BUILDERS.map((b) => b.name))("%s — 종료 후 화면 언어가 복원된다", (name) => {
    const builder = BUILDERS.find((b) => b.name === name)!;
    builder.run(makeCtx("en"));
    expect(getLocale()).toBe("ko");
  });

  // 기본값(auto) 경로 파리티 — 생산지가 resolveBodyLocale로 해석한 "ko"가 들어온다.
  it.each(BUILDERS.map((b) => b.name))("%s — bodyLocale ko면 한국어 헤딩 (기본값 파리티)", (name) => {
    const builder = BUILDERS.find((b) => b.name === name)!;
    const out = serialize(builder.run(makeCtx("ko")));
    expect(out).toContain("재현 환경");
    expect(out).not.toContain("Environment");
  });

  it("사용자가 쓴 본문은 번역되지 않는다 (스캐폴딩만 바뀐다)", () => {
    const md = buildIssueMarkdown(makeCtx("en"));
    expect(md).toContain("사용자가 쓴 본문");
  });

  it("labelOverride는 본문 언어보다 우선한다", () => {
    const cfg: IssueSection[] = [
      { ...sectionConfig[0], labelOverride: "나의 설명" },
      ...sectionConfig.slice(1),
    ];
    const md = buildIssueMarkdown(makeCtx("en", { sectionConfig: cfg }));
    expect(md).toContain("나의 설명");
    expect(md).not.toContain("## Description");
  });

  it("빌더가 throw해도 화면 언어가 복원된다", () => {
    expect(() =>
      buildIssueMarkdown(makeCtx("en", { sectionConfig: undefined as never })),
    ).toThrow();
    expect(getLocale()).toBe("ko");
  });
});

// 이 설계의 진짜 무음 실패 모드. TiptapEditor의 zustand subscribe 콜백은 set() 호출 스택에서
// 동기로 발화하므로, withLocale 구간 안에서 settings store에 write가 일어나면 구독자가 그
// 자리에서 setLocale(화면 언어)로 덮어써 그 지점 이후의 빌드만 화면 언어로 돈다.
describe("래핑 구간 안 store write 금지 (불변식)", () => {
  it("빌더는 settings store에 write하지 않는다", () => {
    const writes = vi.fn();
    const unsubscribe = useSettingsUiStore.subscribe(writes);
    try {
      for (const builder of BUILDERS) builder.run(makeCtx("en"));
    } finally {
      unsubscribe();
    }
    expect(writes).not.toHaveBeenCalled();
  });

  // 위 단언이 공허하지 않음을 실증한다. 실제 구독자(TiptapEditor.tsx:221·:383)는 값이 바뀔
  // 때만 발화하므로 — `if (s.locale === prev.locale) return` — 같은 값 write로 실증하면
  // 구독자가 아예 안 불려 이 케이스 자체가 공허해진다. 시작 상태를 기대값과 다르게 심는다.
  it("실증: 래핑 구간 안에서 locale이 바뀌는 write가 일어나면 본문 언어가 덮인다", () => {
    const store = useSettingsUiStore.getState();
    const original = store.locale;
    store.setLocale("ko");
    setLocale("ko"); // withLocale("ko") 구간 안을 모사 — 본문 언어로 스왑된 상태
    const unsubscribe = useSettingsUiStore.subscribe((s, prev) => {
      if (s.locale === prev.locale) return;
      setLocale(s.locale);
    });
    try {
      expect(getLocale()).toBe("ko");
      useSettingsUiStore.getState().setLocale("en");
      expect(getLocale()).toBe("en"); // 본문 언어가 화면 언어로 덮였다
    } finally {
      unsubscribe();
      useSettingsUiStore.getState().setLocale(original);
    }
  });
});

// 이 래퍼는 buildReportData.test.ts가 @/i18n을 모킹하고 dateBcp47을 "en-US" 상수로 고정해
// 관측할 수 없다 — 지워도 그쪽은 green이다. 실사전으로 여기서만 잡힌다.
describe("deriveContextEnvRows — Captured 값도 본문 언어를 따른다", () => {
  const captured = (bodyLocale: LocaleMode) =>
    deriveContextEnvRows(makeCtx(bodyLocale)).find((r) => r.label === "Captured")!.value;

  it("bodyLocale en이면 en-US 날짜 스켈레톤이다", () => {
    expect(captured("en")).toMatch(/^\d{2}\/\d{2}\/\d{4},/);
  });

  it("bodyLocale ko면 ko-KR 날짜 스켈레톤이다", () => {
    expect(captured("ko")).toMatch(/^\d{4}\. \d{2}\. \d{2}\./);
  });

  it("두 로케일의 출력이 실제로 다르다", () => {
    expect(captured("en")).not.toBe(captured("ko"));
  });

  it("호출 후 화면 언어가 복원된다", () => {
    setLocale("ko");
    deriveContextEnvRows(makeCtx("en"));
    expect(getLocale()).toBe("ko");
  });
});

// logs.html Report 탭 — 제출 본문과 문자열이 일치해야 하므로 본문 언어로 박제된다.
describe("buildReportData 박제", () => {
  const baseInput = (bodyLocale: LocaleMode, cfg: IssueSection[] = sectionConfig) => ({
    title: "리포트 제목",
    sections: {
      description: "버그 설명",
      stepsToReproduce: "1단계",
      expectedResult: "기대 결과",
    } as Record<string, string>,
    sectionConfig: cfg,
    envRows: [{ label: "OS", value: "macOS" }],
    markdownContext: makeCtx(bodyLocale, { sectionConfig: cfg }),
  });

  it("envTitle이 본문 언어로 박제된다", async () => {
    const report = await buildReportData(baseInput("en"));
    expect(report.envTitle).toBe("Environment");
  });

  it("섹션 라벨이 본문 언어로 박제된다", async () => {
    const report = await buildReportData(baseInput("en"));
    expect(report.sections.map((s) => s.label)).toEqual([
      "Description",
      "Steps to reproduce",
      "Expected result",
    ]);
  });

  // ":70이 문자 그대로 buildIssueMarkdown(copyCtx)를 호출하므로 "출력이 서로 같다"는 항진명제다.
  // 리터럴로 단언해야 그물이 의미를 얻는다.
  it("copy.markdown에 영어 헤딩이 실린다 (리터럴 단언)", async () => {
    const report = await buildReportData(baseInput("en"));
    expect(report.copy.markdown).toContain("## Environment");
    expect(report.copy.markdown).not.toContain("## 재현 환경");
  });

  it("bodyLocale ko면 한국어 헤딩으로 박제된다", async () => {
    const report = await buildReportData(baseInput("ko"));
    expect(report.envTitle).toBe("재현 환경");
    expect(report.copy.markdown).toContain("## 재현 환경");
  });

  it("labelOverride는 본문 언어와 무관하게 유지된다", async () => {
    const cfg: IssueSection[] = [
      { ...sectionConfig[0], labelOverride: "  나의 설명  " },
      ...sectionConfig.slice(1),
    ];
    const report = await buildReportData(baseInput("en", cfg));
    expect(report.sections[0].label).toBe("나의 설명");
  });

  it("완료 후 화면 언어가 복원된다 (async tail만 감싼다)", async () => {
    setLocale("ko");
    await buildReportData(baseInput("en"));
    expect(getLocale()).toBe("ko");
  });
});
