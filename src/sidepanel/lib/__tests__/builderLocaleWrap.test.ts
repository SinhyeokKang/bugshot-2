import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 이슈 본문 언어는 빌더 진입점의 withLocale 래핑으로 구현된다. 새 플랫폼 어댑터가 래핑을
// 잊으면 화면 언어가 무음으로 새므로 — 골든 스냅샷은 @/i18n을 통째로 모킹해 이 회귀에
// 눈이 멀어 있다 — 소스 스캔으로 red를 만든다. locale-registry.test.ts의 "순수성" 방식.
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// dateBcp47도 센다 — t() 없이 날짜만 로케일을 타는 파일(formatTimestamp)이 t 기준 스캔에선
// 통째로 사정권 밖이라, "본문 언어를 타는 표면"의 전수가 t 사용처보다 넓다.
const IMPORTS_T = /import\s*\{[^}]*\b(?:t|dateBcp47)\b[^}]*\}\s*from\s*["']@\/i18n["']/;
// 판정 3종과 래핑 구간 제거는 background 게이트와 공유한다 — 복제하면 한쪽만 강화된다.
import {
  CALLS_T,
  CALLS_WITH_LOCALE,
  IMPORTS_WITH_LOCALE,
  exportedSegments,
  stripWithLocaleCalls,
} from "@/test/withLocaleScan";

// 진입점이라 감싼다. 이 목록이 곧 "본문 언어를 박제하는 표면"의 전수다.
const WRAPPED = [
  "buildAsanaIssueBody.ts",
  "buildClickupIssueBody.ts",
  "buildIssueAdf.ts",
  "buildIssueMarkdown.ts",
  "buildLinearIssueBody.ts",
  "buildMarkdownIssueBody.ts",
  "buildNotionIssueBody.ts",
  "buildReportData.ts",
  "buildSlackBody.ts",
  "buildWebhookJsonBody.ts",
  "webhookPayload.ts",
];

// 감싸면 안 되거나 감쌀 진입점이 없는 파일 — 이유를 함께 박아 다음 사람이 판단을 복원할 수 있게 한다.
const EXEMPT: Record<string, string> = {
  "formatTimestamp.ts": "표시 헬퍼 — 호출자(감싸진 빌더 / 화면 미리보기)의 로케일을 그대로 따른다",
  "issueBodyShared.ts": "빌더 내부 헬퍼 — 진입점이 아니라 감싸진 구간 안에서만 불린다",
  "markdownToAdf.ts": "빌더 내부 변환기 — 진입점이 아니라 감싸진 구간 안에서만 불린다",
  "markdownToNotionBlocks.ts": "빌더 내부 변환기 — 위와 동일",
  "prepareUpload.ts": "에러 토스트 — 화면 언어가 정답",
  "submitToWebhook.ts":
    "에러 토스트 — 화면 언어가 정답. 본문에 실리는 문구는 buildWebhookJsonBody로 떼어내 거기서 감쌌다",
};

interface LibFile {
  file: string;
  source: string;
}

// 재귀 — lib/prompts/처럼 하위 디렉터리에 생긴 빌더가 스캔 밖으로 새면 미분류 검사가 통째로
// 무음 통과한다. 경로는 LIB_DIR 상대로 보존해 소유자 재읽기가 어긋나지 않게 한다.
function readLibFiles(dir: string, prefix = ""): LibFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return e.name === "__tests__" ? [] : readLibFiles(join(dir, e.name), `${prefix}${e.name}/`);
    }
    if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts")) return [];
    return [{ file: `${prefix}${e.name}`, source: readFileSync(join(dir, e.name), "utf8") }];
  });
}

const all: LibFile[] = readLibFiles(LIB_DIR);

// 본문 t()의 실제 소유자는 아래 셋이다 — EXEMPT가 "빌더 내부 헬퍼"로 분류한 파일들이고,
// 이들을 부르는 쪽이 감싸지 않으면 본문 언어가 샌다. **이들을 import하는 파일도 대상**이어야
// 한다: t를 직접 import하지 않고 헬퍼 경유로만 부르는 파일이 t 기준 스캔에서 통째로 빠지고,
// 실제로 그 구멍으로 payload의 logSummary가 화면 언어로 새어 나갔다.
// withLocale import를 타깃 조건으로 쓰면 안 된다 — 그건 **이미 고친 파일의 특징**이라
// 사후 장부만 되고 같은 실수를 처음 하는 파일은 여전히 안 걸린다.
// t()를 안 쓰면서 로케일을 타는 호출 — 날짜 스켈레톤이 화면 언어로 굳는 경로다. 이 축이 스캔
// 밖이던 동안 webhook payload의 환경 행이 게이트를 그냥 통과했다(감싸져 있었지만 우연이었다).
// 자기 자신을 감싸는 진입점(issueEnvironmentRows)은 래핑 제거 후 본문이 비어 자연히 통과한다.
const LOCALE_VALUE_HELPERS = [/(?<![\w.])formatTimestamp\(/];

const BODY_T_HELPERS = ["issueBodyShared", "markdownToAdf", "markdownToNotionBlocks"];
// 같은 파일을 가리키는 표기가 둘이다 — 이 디렉터리는 `@/` 유지가 지역 관례고(CLAUDE.md),
// 상대경로도 쓰인다. 한쪽만 보면 다른 표기로 쓴 새 빌더가 대상 집합에서 통째로 빠진다.
const HELPER_PATH = `(?:\\.{1,2}/|@/sidepanel/lib/)(?:${BODY_T_HELPERS.join("|")})`;
const IMPORTS_BODY_HELPER = new RegExp(`from\\s*["']${HELPER_PATH}["']`);

// 파일이 본문 헬퍼에서 가져온 심볼 이름들 → 호출 패턴. 파일마다 다르므로 그때그때 판다.
function importedBodyHelperCalls(source: string): RegExp[] {
  const names: string[] = [];
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${HELPER_PATH}["']`,
    "g",
  );
  for (const m of source.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return names.map((n) => new RegExp(`(?<![\\w.])${n}\\(`));
}

const importsT = all.filter(
  (f) => IMPORTS_T.test(f.source) || IMPORTS_BODY_HELPER.test(f.source),
);


describe("본문 빌더 withLocale 래핑 게이트", () => {
  // 앵커가 없으면 스캔이 0개 파일을 훑고도 green이 된다. 하위 디렉터리 파일을 명시해 재귀가
  // 깨지는 것까지 고정한다 — 개수 하한만 두면 재귀 소실이 33→31로 묻힌다.
  it("스캔이 실제로 대상 파일에 도달한다 (자기검증 앵커)", () => {
    expect(all.length).toBeGreaterThan(30);
    expect(importsT.length).toBeGreaterThan(10);
    expect(all.map((f) => f.file)).toContain("buildIssueMarkdown.ts");
    expect(all.some((f) => f.file.includes("/"))).toBe(true);
  });

  // 소스 스캔이 표기 하나에만 눈을 뜨면 같은 import를 다르게 쓴 파일이 통째로 빠진다 —
  // 이 디렉터리는 CLAUDE.md가 `@/` 유지를 지역 관례로 둔 곳이라 그 표기가 언제든 나온다.
  // 지금 저장소에 `@/sidepanel/lib/...` 형태가 0건이라 실해는 없지만, 0건이라는 사실이
  // 그물을 대신하지는 않는다.
  it.each([
    ['import { emitMarkdownLogSummary } from "./issueBodyShared";', "상대경로"],
    ['import { emitMarkdownLogSummary } from "../issueBodyShared";', "상위 상대경로"],
    ['import { emitMarkdownLogSummary } from "@/sidepanel/lib/issueBodyShared";', "@/ 별칭"],
  ])("본문 헬퍼 import를 표기와 무관하게 잡는다 (%s)", (line) => {
    expect(IMPORTS_BODY_HELPER.test(line)).toBe(true);
    expect(importedBodyHelperCalls(line).length).toBe(1);
  });

  // 대상 집합을 파일명 규칙(build*)에 맡기면 markdownToAdf.ts처럼 t()를 쓰는 파일이 사정권
  // 밖으로 샌다. lib 전체를 훑고 분류를 강제해, 새 파일은 어느 쪽에도 없어 red가 되게 한다.
  // **한계 — 직접 import 기준이다.** t를 파라미터로 받는 파일(llmErrorToast.ts의 TranslationFn)과
  // t 없이 formatTimestamp만 타는 파일(environmentRows.ts)은 이 스캔에 안 걸린다. 둘 다 현재
  // 소비처가 UI·래핑된 빌더뿐이라 무해하지만, 그 형태로 본문 진입점을 만들면 분류를 우회한다.
  it("t()를 쓰는 lib 파일은 전부 래핑 또는 면제로 분류돼 있다 (대상 집합 완전성)", () => {
    const classified = new Set([...WRAPPED, ...Object.keys(EXEMPT)]);
    const unclassified = importsT.map((f) => f.file).filter((f) => !classified.has(f));
    expect(unclassified).toEqual([]);
    // 역방향 — 목록에만 있고 실제로는 t()를 안 쓰는 유령 항목이 남으면 분류가 거짓말이 된다.
    const importing = new Set(importsT.map((f) => f.file));
    expect([...classified].filter((f) => !importing.has(f))).toEqual([]);
  });

  it.each(WRAPPED)("%s — 파일이 withLocale을 import한다", (file) => {
    const entry = all.find((f) => f.file === file)!;
    expect(entry.source).toMatch(IMPORTS_WITH_LOCALE);
  });

  // 파일 단위로만 보면 진입점이 2개인 파일(buildIssueMarkdown)에 3번째가 추가되고 안 감싸져도
  // green이다. export된 선언 하나하나가, 그것도 **래퍼 안에서** t()를 쓰는지까지 본다.
  it.each(WRAPPED)("%s — export 진입점의 t()가 전부 래퍼 안에 있다", (file) => {
    const entry = all.find((f) => f.file === file)!;
    // 헬퍼 호출도 t() 호출로 센다 — 이 파일들이 본문 t()를 소유하므로, 부르는 쪽이 안 감싸면
    // 직접 t()를 쓴 것과 결과가 같다. 이름 기준이라 그 파일에서 import한 심볼만 본다.
    const helperCalls = importedBodyHelperCalls(entry.source);
    // t() 없이 로케일을 타는 축도 센다 — formatTimestamp는 dateBcp47()를, issueEnvironmentRows는
    // 그 formatTimestamp를 탄다. 이 축이 스캔 밖이던 동안 webhook payload의 환경 행이 게이트를
    // 그냥 통과했다(감싸져 있었지만 그건 우연이었다).
    const leaks = (body: string) =>
      CALLS_T.test(body) ||
      LOCALE_VALUE_HELPERS.some((re) => re.test(body)) ||
      helperCalls.some((re) => re.test(body));
    const leaking = exportedSegments(entry.source)
      .filter((s) => leaks(stripWithLocaleCalls(s.body)))
      .map((s) => s.name);
    expect(leaking).toEqual([]);
  });

  // 괄호 매칭이 깨지면 위 검사는 "t()가 아예 없다"만 재는 공허한 그물로 조용히 전락한다.
  // 양방향으로 실증한다 — 안쪽은 지우고 바깥쪽은 남기는지.
  it("래핑 구간 제거가 양방향으로 동작한다 (자기검증 앵커)", () => {
    const wrapped = `export function x(ctx) { return withLocale(ctx.bodyLocale, () => t("a") + f(g(1))); }`;
    expect(CALLS_T.test(wrapped)).toBe(true);
    expect(CALLS_T.test(stripWithLocaleCalls(wrapped))).toBe(false);

    // DataFlow 검증이 실증한 누출 형태 — 헤딩만 래퍼 밖에서 굳는다.
    const leaky = `export function x(ctx) { const h = t("a"); return withLocale(ctx.bodyLocale, () => h); }`;
    expect(CALLS_T.test(stripWithLocaleCalls(leaky))).toBe(true);

    // 실제 소스에서도 지워지는 게 있어야 한다(정규식이 파일에 도달했는지).
    const entry = all.find((f) => f.file === "buildReportData.ts")!;
    expect(stripWithLocaleCalls(entry.source).length).toBeLessThan(entry.source.length);
  });

  it("면제 파일은 withLocale을 쓰지 않는다 (면제가 실제 상태와 일치)", () => {
    for (const file of Object.keys(EXEMPT)) {
      const entry = all.find((f) => f.file === file)!;
      expect(entry.source, `${file}: ${EXEMPT[file]}`).not.toMatch(CALLS_WITH_LOCALE);
    }
  });

  // 위임만 하는 어댑터는 t()가 0회다 — 감쌀 것이 없고, 위임 대상이 감싸지면 따라온다.
  it("t()를 안 쓰는 위임 어댑터(github·gitlab)는 대상에서 제외된다", () => {
    const files = importsT.map((f) => f.file);
    expect(files).not.toContain("buildGithubIssueBody.ts");
    expect(files).not.toContain("buildGitlabIssueBody.ts");
    // 그 파일들이 실제로 존재하는지까지 확인 — 오타로 사라지면 위 단언이 공허해진다.
    expect(all.map((f) => f.file)).toContain("buildGithubIssueBody.ts");
    expect(all.map((f) => f.file)).toContain("buildGitlabIssueBody.ts");
  });
});
