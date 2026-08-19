import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// store가 사이드패널 컴포넌트 그래프나 background를 물면 그게 background 번들까지 딸려간다.
// 이 경계는 typecheck도 테스트도 안 잡아서(둘 다 green인 채로 번들만 커진다) 소스 스캔이
// 유일한 그물이다. `@/sidepanel` 전체를 금지하지는 않는다 — `sidepanel/lib` 경유와 명시
// leaf(picker-clear·recorder-control)는 의도된 승격 경로다.
const FORBIDDEN = [
  { needle: "sidepanel/components/", why: "컴포넌트 그래프" },
  { needle: "sidepanel/tabs/", why: "탭 컴포넌트" },
  { needle: "sidepanel/hooks/", why: "React 훅" },
  { needle: "sidepanel/picker-control", why: "picker 런타임 (leaf는 picker-clear)" },
  { needle: "background/", why: "OAuth 런처·설정 저장소" },
  // CLAUDE.md: "이 스토어가 background 번들에 들어가므로 dnd-kit을 그래프에 유입시키지
  // 않는다" — arrayMove가 스토어에 인라인된 이유가 이것이다.
  { needle: "@dnd-kit/", why: "본문 순서 재정렬 UI 의존성" },
];

// `import type`은 빌드에서 지워져 런타임 edge가 0이라 대상이 아니다(CLAUDE.md도 "value
// import"). 문장 선두 `import type`과 인라인 `{ type X }` 둘 다 걷어낸다 — 후자를 안
// 걷으면 리포맷 한 번에 거짓 red가 난다.
function valueImportSource(src: string): string {
  return src
    .replace(/import\s+type\s+[\s\S]*?from\s*["'][^"']+["']/g, "")
    .replace(/\{[^{}]*\}/g, (block) =>
      /^\{\s*(type\s+[A-Za-z0-9_]+\s*,?\s*)+\}$/.test(block) ? "" : block,
    );
}

describe("store 번들 경계", () => {
  it.each(FORBIDDEN)("src/store/가 $needle를 value import하지 않는다 ($why)", ({ needle }) => {
    const offenders = walkSources(join(process.cwd(), "src/store"))
      .filter((p) => valueImportSource(readFileSync(p, "utf8")).includes(needle))
      .map(relToRepo);

    expect(offenders).toEqual([]);
  });
});
