import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// 같은 최상위 디렉터리 안에서는 상대경로를 쓴다. `@/`는 디렉터리를 **건널 때**의 표기라,
// 자기 디렉터리를 `@/`로 가리키면 같은 모듈이 두 표기로 불려 grep·이동이 어긋난다.
//
// `src/sidepanel`은 대상에서 뺀다 — 이미 혼용이라 즉시 red이고, 예외 목록을 박으면
// 그물이 아니라 장부가 된다. 나머지 넷은 지금 0건이라 래칫으로 잠근다.
const SCOPES = ["background", "types", "store", "i18n"];

// `from "…"` 형태만 센다. 동적 import·`vi.mock`·주석까지 세면 그물이 아니라 오탐기가 된다.
// (`__tests__`는 walkSources가 이미 제외한다 — `vi.mock`은 SUT와 같은 specifier여야 하므로
//  거기서 `@/`를 쓰는 건 이탈이 아니라 요구사항이다.)
function selfAliasImports(src: string, scope: string): string[] {
  const re = new RegExp(`from\\s+"(@/${scope}/[^"]+)"`, "g");
  return [...src.matchAll(re)].map((m) => m[1]);
}

describe("import 표기 컨벤션", () => {
  it.each(SCOPES)("src/%s/ 안에서는 자기 디렉터리를 @/로 가리키지 않는다", (scope) => {
    const offenders = walkSources(join(process.cwd(), "src", scope))
      .flatMap((p) => {
        const hits = selfAliasImports(readFileSync(p, "utf8"), scope);
        return hits.map((h) => `${relToRepo(p)} → ${h}`);
      });

    expect(offenders).toEqual([]);
  });
});
