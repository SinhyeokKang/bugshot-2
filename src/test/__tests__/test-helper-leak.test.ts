import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { relToRepo, walkSources } from "../sourceFiles";

// `src/test/`는 테스트 전용 하네스다. 프로덕션 코드가 여길 import해도 지금은 아무것도 안 잡는다 —
// 린터가 없고, tsconfig.app.json의 include가 src 전체라 typecheck는 통과하며,
// bundleBoundary·import-convention 어느 스캔의 대상 디렉터리도 아니다. 위반 0건은 규율이지
// 그물이 아니었다. fetch-mock이 어댑터 테스트 8곳에서 널리 쓰이면 "프로덕션에서도 쓰자"는
// 유혹이 커지므로(log-throttle이 겪은 것과 같은 계열) 여기서 래칫으로 잠근다.
//
// walkSources가 `__tests__`를 prune하므로 정당한 소비처(테스트 파일)는 애초에 대상 밖이고,
// src/test/ 자기 내부도 뺀다. 남는 건 "프로덕션 코드"뿐이다.
const TEST_ALIAS =
  /(?:from\s+|^\s*import\s+|import\(\s*)["'](@\/test(?:\/[^"']*)?)["']/gm;

function testAliasImports(src: string): string[] {
  return [...src.matchAll(TEST_ALIAS)].map((m) => m[1]);
}

const SRC = join(process.cwd(), "src");
const TEST_DIR = join(SRC, "test") + sep;

const productionFiles = () => walkSources(SRC).filter((p) => !p.startsWith(TEST_DIR));

describe("테스트 하네스 누출 방지", () => {
  // 대상 집합이 0건이라 정규식이 통째로 망가져도 아래 검사는 green이다.
  // 스캐너가 실제로 무언가를 잡는다는 것 자체를 고정한다.
  it("스캐너가 @/test 참조를 잡는다 (자기검증 앵커)", () => {
    expect(testAliasImports('import { mockFetchOnce } from "@/test/fetch-mock";')).toEqual([
      "@/test/fetch-mock",
    ]);
    expect(testAliasImports("import { walkSources } from '@/test/sourceFiles';")).toEqual([
      "@/test/sourceFiles",
    ]);
    expect(testAliasImports('import "@/test/setup-dom";')).toEqual(["@/test/setup-dom"]);
    expect(testAliasImports('const m = await import("@/test/fetch-mock");')).toEqual([
      "@/test/fetch-mock",
    ]);
    // 디렉터리 자체를 가리키는 형태도 이탈이다.
    expect(testAliasImports('import x from "@/test";')).toEqual(["@/test"]);
  });

  it("이름이 비슷한 다른 경로는 잡지 않는다 (오탐 앵커)", () => {
    expect(testAliasImports('import { x } from "@/testing/helpers";')).toEqual([]);
    expect(testAliasImports('import { x } from "@/types/notion";')).toEqual([]);
    expect(testAliasImports('import { x } from "@/lib/url-support";')).toEqual([]);
  });

  // 정규식이 살아 있어도 walk·필터가 빈 배열을 내면 본 검사가 조용히 통과한다.
  // 대상 집합 자체를 앵커로 고정한다.
  it("스캔 대상(프로덕션 파일)이 비어 있지 않다 (앵커)", () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((p) => p.startsWith(TEST_DIR))).toBe(false);
  });

  it("프로덕션 코드가 @/test/*를 import하지 않는다", () => {
    const offenders = productionFiles().flatMap((p) =>
      testAliasImports(readFileSync(p, "utf8")).map((h) => `${relToRepo(p)} → ${h}`),
    );

    expect(offenders).toEqual([]);
  });
});
