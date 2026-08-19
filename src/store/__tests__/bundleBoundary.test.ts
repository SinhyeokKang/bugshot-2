import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// store가 사이드패널 컴포넌트 그래프를 물면 그게 background 번들까지 딸려간다. 이 경계는
// typecheck도 테스트도 안 잡아서(둘 다 green인 채로 번들만 커진다) 소스 스캔이 유일한 그물이다.
// `@/sidepanel` 전체를 금지하지는 않는다 — `sidepanel/lib` 경유는 의도된 승격 경로다.
// `import type`은 빌드에서 지워져 런타임 edge가 0이라 대상이 아니다(CLAUDE.md도 "value import").
const FORBIDDEN = [
  "@/sidepanel/components/",
  "@/sidepanel/tabs/",
  "@/sidepanel/picker-control",
  "@/background/",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("store 번들 경계", () => {
  it.each(FORBIDDEN)("src/store/가 %s를 import하지 않는다", (needle) => {
    const offenders = walk(join(process.cwd(), "src/store"))
      .filter((p) =>
        readFileSync(p, "utf8")
          .split("\n")
          .some((line) => line.includes(needle) && !/^\s*import type /.test(line)),
      )
      .map((p) => p.replace(`${process.cwd()}/`, ""));

    expect(offenders).toEqual([]);
  });
});
