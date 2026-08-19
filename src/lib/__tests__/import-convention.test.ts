import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// 같은 최상위 디렉터리 안에서는 상대경로를 쓴다. `@/`는 디렉터리를 **건널 때**의 표기라,
// 자기 디렉터리를 `@/`로 가리키면 같은 모듈이 두 표기로 불려 grep·이동이 어긋난다.
//
// 스코프를 넷으로 좁힌 근거: 지금 0건이라 래칫으로 잠글 수 있는 곳만 넣었다. `sidepanel`(445건)·
// `log-viewer`(9건)는 이미 혼용이라 즉시 red이고, 예외 목록을 박으면 그물이 아니라 장부가 된다.
// `components`는 shadcn CLI 생성물이라 우리 컨벤션의 대상이 아니다. `content`·`lib`·`test`도
// 0건이지만 자기참조가 생길 만한 깊이가 아니라 뺐다 — 필요해지면 여기 추가한다.
const SCOPES = ["background", "types", "store", "i18n"];

// `from "…"`과 부수효과 `import "…"` 둘 다 센다. 동적 import·`vi.mock`은 제외 — `vi.mock`은
// SUT와 같은 specifier여야 하므로 거기서 `@/`를 쓰는 건 이탈이 아니라 요구사항이다
// (`__tests__`는 walkSources가 이미 제외한다).
function selfAliasImports(src: string, scope: string): string[] {
  const re = new RegExp(`(?:from\\s+|^\\s*import\\s+)["'](@/${scope}(?:/[^"']*)?)["']`, "gm");
  return [...src.matchAll(re)].map((m) => m[1]);
}

describe("import 표기 컨벤션", () => {
  // 4개 스코프가 전부 0건이라, 정규식이 통째로 망가져도 아래 검사는 green이다.
  // 스캐너가 실제로 무언가를 잡는다는 것 자체를 고정한다.
  it("스캐너가 이탈을 잡는다 (자기검증 앵커)", () => {
    expect(selfAliasImports('import { x } from "@/background/y";', "background")).toEqual([
      "@/background/y",
    ]);
    expect(selfAliasImports("import { x } from '@/types/z';", "types")).toEqual(["@/types/z"]);
    expect(selfAliasImports('import "@/store/side-effect";', "store")).toEqual([
      "@/store/side-effect",
    ]);
    // 디렉터리 자체를 가리키는 bare index도 이탈이다.
    expect(selfAliasImports('import { t } from "@/i18n";', "i18n")).toEqual(["@/i18n"]);
    // 다른 스코프는 잡지 않는다.
    expect(selfAliasImports('import { x } from "@/lib/y";', "background")).toEqual([]);
  });

  // 정규식이 살아 있어도 walk가 빈 배열을 내면 4케이스가 조용히 통과한다 — 스코프 오타·
  // 디렉터리 이동이 그 형태다. 대상 집합 자체를 앵커로 고정한다.
  it.each(SCOPES)("src/%s/ 스캔 대상이 비어 있지 않다 (앵커)", (scope) => {
    expect(walkSources(join(process.cwd(), "src", scope)).length).toBeGreaterThan(0);
  });

  it.each(SCOPES)("src/%s/ 안에서는 자기 디렉터리를 @/로 가리키지 않는다", (scope) => {
    const offenders = walkSources(join(process.cwd(), "src", scope)).flatMap((p) => {
      const hits = selfAliasImports(readFileSync(p, "utf8"), scope);
      return hits.map((h) => `${relToRepo(p)} → ${h}`);
    });

    expect(offenders).toEqual([]);
  });
});
