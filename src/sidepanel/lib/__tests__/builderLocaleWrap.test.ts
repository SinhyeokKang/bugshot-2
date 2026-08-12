import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 이슈 본문 언어는 빌더 진입점의 withLocale 래핑으로 구현된다. 새 플랫폼 어댑터가 래핑을
// 잊으면 화면 언어가 무음으로 새므로 — 골든 스냅샷은 @/i18n을 통째로 모킹해 이 회귀에
// 눈이 멀어 있다 — 소스 스캔으로 red를 만든다. locale-registry.test.ts의 "순수성" 방식.
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Builder {
  file: string;
  source: string;
}

function readBuilders(): Builder[] {
  return readdirSync(LIB_DIR)
    .filter((f) => /^build.*\.ts$/.test(f))
    .map((file) => ({ file, source: readFileSync(join(LIB_DIR, file), "utf8") }));
}

const IMPORTS_T = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']@\/i18n["']/;

const all = readBuilders();
const wrapRequired = all.filter((b) => IMPORTS_T.test(b.source));

describe("본문 빌더 withLocale 래핑 게이트", () => {
  // 앵커가 없으면 스캔이 0개 파일을 훑고도 green이 된다.
  it("스캔이 실제로 대상 파일에 도달한다 (자기검증 앵커)", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(wrapRequired).toHaveLength(9);
    expect(wrapRequired.map((b) => b.file).sort()).toEqual([
      "buildAsanaIssueBody.ts",
      "buildClickupIssueBody.ts",
      "buildIssueAdf.ts",
      "buildIssueMarkdown.ts",
      "buildLinearIssueBody.ts",
      "buildMarkdownIssueBody.ts",
      "buildNotionIssueBody.ts",
      "buildReportData.ts",
      "buildSlackBody.ts",
    ]);
  });

  it.each(wrapRequired.map((b) => b.file))(
    "%s — t()를 쓰는 빌더는 withLocale로 감싼다",
    (file) => {
      const builder = wrapRequired.find((b) => b.file === file)!;
      expect(builder.source).toMatch(/\bwithLocale\s*\(/);
      expect(builder.source).toMatch(
        /import\s*\{[^}]*\bwithLocale\b[^}]*\}\s*from\s*["']@\/i18n["']/,
      );
    },
  );

  // 위임만 하는 어댑터는 t()가 0회다 — 감쌀 것이 없고, 위임 대상이 감싸지면 따라온다.
  it("t()를 안 쓰는 위임 어댑터(github·gitlab)는 대상에서 제외된다", () => {
    const files = wrapRequired.map((b) => b.file);
    expect(files).not.toContain("buildGithubIssueBody.ts");
    expect(files).not.toContain("buildGitlabIssueBody.ts");
    // 그 파일들이 실제로 존재하는지까지 확인 — 오타로 사라지면 위 단언이 공허해진다.
    expect(all.map((b) => b.file)).toContain("buildGithubIssueBody.ts");
    expect(all.map((b) => b.file)).toContain("buildGitlabIssueBody.ts");
  });
});
