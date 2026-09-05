import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// store가 사이드패널 컴포넌트 그래프나 background를 물면 그게 background 번들까지 딸려간다.
// 이 경계는 typecheck도 테스트도 안 잡아서(둘 다 green인 채로 번들만 커진다) 소스 스캔이
// 유일한 그물이다.
//
// 판정은 **화이트리스트**다 — 금지 경로를 열거하던 시절 `sidepanel/App`·`capture`·
// `video-capture`·`annotation-control`·`tab-nav`가 통째로 스캔 밖이었다(특히 App 유입은
// app-events가 존재하는 이유 그 자체다). 열거는 다음에 생기는 루트 파일에서 또 열린다.
// alias·상대경로 둘 다 본다. 앞선 `.includes(needle)` 판정은 열거 탓에 루트 파일을 놓쳤지만
// 상대경로 탈출은 우연히 잡았다 — 전환하며 그 벡터를 잃지 않는다. trailing slash를 요구하지
// 않는 것도 그래서다: bare `@/background`는 SW 엔트리(`background/index.ts`)로 최악의 유입이다.
const POLICED =
  /^(?:@\/|(?:\.\.\/)+)(?:sidepanel|background)(?:\/|$)|^@dnd-kit(?:\/|$)/;

// store가 물어도 되는 것: `sidepanel/lib` 순수 로직과 명시 leaf. 여기 없는 `@/sidepanel/*`·
// `@/background/*`·`@dnd-kit/*` **alias specifier**는 위반이다(상대경로 탈출 `../sidepanel/…`은
// 지금 0건이고 이 판정 밖이다). 새 승격 경로를 뚫으면 이 목록에 등재한다 — 아래 "목록이
// 장부가 되지 않는다"가 죽은 항목을 red로 잡는다.
const ALLOWED = [
  "@/sidepanel/picker-clear",
  "@/sidepanel/recorder-control",
  "@/sidepanel/lib/aiLanguage",
  "@/sidepanel/lib/initialJiraFields",
  "@/sidepanel/lib/attachmentLimits",
  "@/sidepanel/lib/annotationDefaults",
  "@/sidepanel/lib/pageUrl",
];

// `import type`은 빌드에서 지워져 런타임 edge가 0이라 대상이 아니다(CLAUDE.md도 "value
// import"). 문장 선두 `import type`과 인라인 all-type(`{ type A, type B }`) 둘 다 **from 절까지
// 문장 단위로** 지운다 — 블록만 비우면 specifier 문자열이 남아 needle이 그대로 매칭된다.
function valueImportSource(src: string): string {
  return src
    .replace(/import\s+type\s+[\s\S]*?from\s*["'][^"']+["']/g, "")
    .replace(
      /import\s*\{\s*(?:type\s+[A-Za-z0-9_$]+\s*(?:as\s+[A-Za-z0-9_$]+\s*)?,?\s*)+\}\s*from\s*["'][^"']+["']/g,
      "",
    );
}

// `from "…"`·부수효과 `import "…"`·동적 `import("…")`를 센다. `from`·`import` 뒤 공백을
// 필수로 두면 `from"…"` 리포맷 한 번에 그 파일이 통째로 스캔 밖이 된다.
function importSpecifiers(src: string): string[] {
  const re = /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*)["']([^"']+)["']/gm;
  return [...valueImportSource(src).matchAll(re)].map((m) => m[1]);
}

function offendingSpecifiers(src: string): string[] {
  return importSpecifiers(src).filter((s) => POLICED.test(s) && !ALLOWED.includes(s));
}

// 4스코프가 이미 0건인 래칫형 스캔은 offenders를 만드는 쪽이 어떤 이유로든 0을 내면 통과한다
// (POSTMORTEM 2026-08-19 — "전수 스캔의 대상 집합이 비면 스캔 자체가 항진명제다").
// 스캐너가 실제로 무언가를 잡는다는 것 자체를 먼저 고정한다.
describe("store 번들 경계 — 스캐너 자기검증", () => {
  it("금지 경로의 value import를 잡는다", () => {
    expect(offendingSpecifiers('import { X } from "@/sidepanel/components/Foo";')).toEqual([
      "@/sidepanel/components/Foo",
    ]);
    expect(offendingSpecifiers('import { x } from "@/background/oauth";')).toEqual([
      "@/background/oauth",
    ]);
    expect(offendingSpecifiers('import { arrayMove } from "@dnd-kit/sortable";')).toEqual([
      "@dnd-kit/sortable",
    ]);
    // 열거 시절 스캔 밖이던 sidepanel 루트 파일들.
    expect(offendingSpecifiers('import { x } from "@/sidepanel/App";')).toEqual([
      "@/sidepanel/App",
    ]);
    expect(offendingSpecifiers('import { x } from "@/sidepanel/video-capture";')).toEqual([
      "@/sidepanel/video-capture",
    ]);
    // 부수효과 import도 런타임 edge다.
    expect(offendingSpecifiers('import "@/sidepanel/tab-nav";')).toEqual(["@/sidepanel/tab-nav"]);
    // 상대경로 탈출·동적 import·무공백 from — alias만 보면 통째로 새는 3벡터.
    expect(offendingSpecifiers('import { x } from "../sidepanel/components/Foo";')).toEqual([
      "../sidepanel/components/Foo",
    ]);
    expect(offendingSpecifiers('import { x } from "../../background/oauth";')).toEqual([
      "../../background/oauth",
    ]);
    expect(offendingSpecifiers('const m = await import("@/sidepanel/components/Foo");')).toEqual([
      "@/sidepanel/components/Foo",
    ]);
    expect(offendingSpecifiers('import { x } from"@/background/oauth";')).toEqual([
      "@/background/oauth",
    ]);
    // bare 디렉터리 참조 — `background/index.ts`는 SW 엔트리다.
    expect(offendingSpecifiers('import { x } from "@/background";')).toEqual(["@/background"]);
  });

  it("type-only import는 걷는다 (런타임 edge 0)", () => {
    expect(
      offendingSpecifiers('import type { X } from "@/sidepanel/components/Foo";'),
    ).toEqual([]);
    // 인라인 all-type — 블록만 비우고 from 절을 남기면 여기서 red가 난다.
    expect(offendingSpecifiers('import { type X } from "@/sidepanel/components/Foo";')).toEqual([]);
    expect(
      offendingSpecifiers('import { type X as Y } from "@/sidepanel/components/Foo";'),
    ).toEqual([]);
  });

  it("값이 하나라도 섞이면 value import다", () => {
    expect(offendingSpecifiers('import { y, type X } from "@/sidepanel/components/Foo";')).toEqual([
      "@/sidepanel/components/Foo",
    ]);
  });

  it("화이트리스트 등재 경로와 무관 경로는 통과", () => {
    expect(offendingSpecifiers('import { clearPicker } from "@/sidepanel/picker-clear";')).toEqual(
      [],
    );
    expect(offendingSpecifiers('import { t } from "@/i18n";')).toEqual([]);
    // 하위 경로는 다른 모듈이다 — 등재된 이름의 접두라고 통과시키지 않는다.
    expect(offendingSpecifiers('import { x } from "@/sidepanel/picker-clear/deep";')).toEqual([
      "@/sidepanel/picker-clear/deep",
    ]);
  });
});

describe("store 번들 경계", () => {
  const files = walkSources(join(process.cwd(), "src/store"));

  it("스캔 대상이 비어 있지 않다 (앵커)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("허용 목록 밖의 사이드패널·background·dnd-kit을 value import하지 않는다", () => {
    const offenders = files.flatMap((p) => {
      const hits = offendingSpecifiers(readFileSync(p, "utf8"));
      return hits.map((h) => `${relToRepo(p)} → ${h}`);
    });

    expect(offenders).toEqual([]);
  });

  // 목록이 장부가 되지 않게 — 승격을 되돌렸는데 항목만 남으면 그만큼 그물이 헐거워진다.
  // 한계: 등재 경로를 정당하게 `import type`으로 좁히면 여기가 거짓 red다(그때 목록에서
  // 지우는 게 맞는 대응이라 그대로 둔다).
  it("허용 목록에 죽은 항목이 없다", () => {
    const imported = new Set(files.flatMap((p) => importSpecifiers(readFileSync(p, "utf8"))));
    expect(ALLOWED.filter((a) => !imported.has(a))).toEqual([]);
  });
});

// session-keys는 content picker·background SW·log-viewer 체인·사이드패널이 **전부** 무는 leaf다.
// `EditorPhase`를 위해 `@/store/editor-store`를 type-only로 물고 있는데, `type` 키워드가
// 빠지면 zustand+editor-store가 그 realm 전부에 유입된다 — 그리고 위 스캔은 `src/store`만
// 보므로 이 방향은 무방비다(`src/i18n/locales.ts`의 "런타임 import 0" 불변식과 같은 형태).
describe("session-keys 런타임 import 0", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/session-keys.ts"), "utf8");

  it("소스를 실제로 읽었다 (앵커)", () => {
    expect(source).toContain("FROZEN_PHASES");
  });

  it("value import가 없다", () => {
    expect(importSpecifiers(source)).toEqual([]);
  });
});
