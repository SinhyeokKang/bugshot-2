import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { AA, contrastOnSurface, parseTokens } from "@/test/cssContrast";
import { relToRepo, walkSources } from "@/test/sourceFiles";

// 글자색의 대비는 토큰 이름이 아니라 "무슨 표면 위냐"가 정한다(DESIGN.md §2). `--muted-foreground`는
// `--background`(흰색) 위에선 4.75:1로 AA를 넘지만 `--muted` 위에선 4.34:1로 미달한다.
//
// **금지 목록이 아니라 계산으로 판정한다.** "muted-foreground를 쓰지 마라"로 두면 대체값이
// 무엇이든 통과해서, `text-foreground/60`을 `/50`으로 내리는(라이트 3.69:1) 회귀가 green으로
// 샌다 — 규칙의 본체는 토큰 이름이 아니라 하한이다. 같은 이유로 표면도 이름이 아니라 값으로
// 가른다(`--accent`·`--secondary`가 `--muted`와 동값이다).
//
// tokens.test.ts는 같은 계산을 **CSS 선언**에 적용한다(코드블럭 gutter). 여기는 TSX의 Tailwind
// 클래스가 대상이라 파서만 다르고, 계산은 `@/test/cssContrast`를 공유한다.
const SRC = resolve(__dirname, "../..");
const GLOBALS = join(SRC, "styles", "globals.css");

// shadcn CLI 생성물이라 우리 컨벤션의 대상이 아니다(CLAUDE.md 코드 컨벤션). 안전해서 뺀 게
// 아니다 — `tabs.tsx`의 TabsList 비활성 라벨이 실제로 4.34:1로 렌더되고, 그건 shadcn 기본값을
// 덮는 별도 판단이 필요해 미해결로 남았다.
const OUT_OF_SCOPE = join(SRC, "components", "ui");

// 판정은 **문자열 리터럴 하나** 안에서 표면과 글자색이 만나는 형태만 본다. 조상이 깐 배경 위의
// 자식 텍스트나 `cn("bg-muted", cond && "text-foreground/60")`처럼 리터럴이 갈린 형태는 못 잡는다
// — 넓히면 오탐이 붙어 그물이 장부가 되므로, 실제 위반이 취하는 형태(className 리터럴 한 줄)에
// 맞춰 좁게 둔다. CSS 파일도 사정거리 밖이다(walkSources가 `.tsx?`만 훑는다) — 그쪽 축은
// tokens.test.ts가 파일을 지목해 잡는다.

// 그 테마에서 실제로 적용되는 클래스만 남긴다. `dark:`는 조건부가 아니라 아래 THEMES가 순회하는
// 축 자체라, 다크에선 prefix를 벗겨 base 뒤에 붙인다(뒤가 승자). `hover:` 같은 진짜 조건부는 뺀다.
function themeClasses(literal: string, isDark: boolean): string[] {
  const base: string[] = [];
  const overrides: string[] = [];
  for (const part of literal.split(/\s+/).filter(Boolean)) {
    if (part.startsWith("dark:")) overrides.push(part.slice(5));
    else if (!part.includes(":")) base.push(part);
  }
  return isDark ? [...base, ...overrides] : base;
}

// 표면 승자 후보는 **background-color 유틸리티뿐**이다. `bg-cover`·`bg-clip-text`·
// `bg-gradient-to-r`은 다른 프로퍼티라 색을 안 덮는데, `bg-*` 전부를 후보로 두면 그것들이 뒤에
// 왔을 때 승자를 가로채 위반이 무음 통과한다. 색 토큰(과 표면을 지우는 `bg-transparent`)만
// 후보로 좁힌다 — Tailwind 팔레트 색(`bg-white` 등)은 여기 안 걸려 오탐이 날 수 있지만,
// **누락은 조용하고 오탐은 red로 시끄럽다.**
const bgColor = (cls: string, tokens: Record<string, string>): boolean => {
  const m = /^bg-([\w-]+)(?:\/\d{1,3})?$/.exec(cls);
  return !!m && (m[1] === "transparent" || m[1] in tokens);
};

// 값이 `--muted`와 같은 표면(`bg-muted`·`bg-secondary`·`bg-accent`). 알파가 붙은 `bg-muted/50`은
// 토큰명이 아니라 걸러지는데, 그게 맞다 — 배경이 옅어지면 대비가 오히려 오른다(라이트 4.54:1).
const mutedSurfaceToken = (cls: string, tokens: Record<string, string>): string | null => {
  const m = /^bg-([\w-]+)$/.exec(cls);
  return m && tokens[m[1]] === tokens.muted ? m[1] : null;
};

// `text-foreground/60` → 토큰 `foreground` + 알파 0.6. globals.css에 없는 이름은 색 토큰이
// 아니므로(`text-sm`·`text-red-600`) 스킵된다.
function textToken(cls: string, tokens: Record<string, string>): { name: string; alpha: number } | null {
  const m = /^text-([\w-]+)(?:\/(\d{1,3}))?$/.exec(cls);
  if (!m || !(m[1] in tokens)) return null;
  return { name: m[1], alpha: m[2] ? Number(m[2]) / 100 : 1 };
}

// muted 표면을 스스로 깐 리터럴 중, 글자색 대비가 AA에 못 미치는 것들. 표면·글자색 모두 한
// 리터럴 안의 **마지막** 선언이 승자다(뒤 클래스가 앞을 덮는다).
function offendingLiterals(src: string, tokens: Record<string, string>, isDark: boolean): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
    const classes = themeClasses(m[2], isDark);
    const surface = classes.filter((c) => bgColor(c, tokens)).at(-1);
    const surfaceToken = surface && mutedSurfaceToken(surface, tokens);
    if (!surfaceToken) continue;
    // 원본 클래스를 들고 다닌다 — 다크에서 `dark:`를 벗긴 뒤 이름만 되조립하면 보고된 문자열로
    // 파일을 grep할 수 없다.
    let fg: { cls: string; name: string; alpha: number } | null = null;
    for (const cls of classes) {
      const t = textToken(cls, tokens);
      if (t) fg = { cls, ...t };
    }
    if (!fg) continue;
    const ratio = contrastOnSurface(tokens[fg.name], tokens[surfaceToken], fg.alpha);
    if (ratio < AA) out.push(`${fg.cls} on ${surface} = ${ratio.toFixed(2)}:1`);
  }
  return out;
}

describe("muted 표면 위 글자 대비", () => {
  const THEMES = [
    ["라이트", ":root"],
    ["다크", ".dark"],
  ] as const;

  // 스코프 밖을 걷어내면 위반이 0건이라, 파서나 계산이 통째로 망가져도 본 검사는 green이다.
  // 스캐너가 실제로 무언가를 잡는다는 것 자체를 고정한다.
  it("스캐너가 미달을 잡는다 (자기검증 앵커)", () => {
    const light = parseTokens(GLOBALS, ":root");
    // 이 파일 자신이 스캔 대상이 아니라서(walkSources가 __tests__를 건너뛴다) 아래 리터럴들이
    // 본 검사에 offender로 잡히지 않는다. 그 스킵이 사라지면 여기가 자기 자신을 문다.
    const scan = (s: string) => offendingLiterals(s, light, false);

    // 걷어낸 원래 위반과, 대체값을 한 단계 내린 회귀.
    expect(scan('"w-24 text-sm text-muted-foreground bg-muted"')).toEqual([
      "text-muted-foreground on bg-muted = 4.34:1",
    ]);
    expect(scan('"bg-muted text-foreground/50"')).toHaveLength(1);
    // 실제 채택값은 통과해야 한다.
    expect(scan('"bg-muted text-foreground/60"')).toEqual([]);
    // 옅은 표면·다크 한정 표면은 라이트 muted 표면이 아니다.
    expect(scan('"bg-muted/50 text-muted-foreground"')).toEqual([]);
    expect(scan('"dark:bg-muted text-muted-foreground"')).toEqual([]);
    // 색 토큰이 아닌 text-* 와 variant가 붙은 색은 판정 대상이 아니다.
    expect(scan('"bg-muted text-sm text-red-600 hover:text-muted-foreground"')).toEqual([]);
    // 리터럴이 갈리면 (한계대로) 잡지 않는다.
    expect(scan('cn("bg-muted", "text-muted-foreground")')).toEqual([]);
  });

  // 표면 판정이 토큰 **이름**이면 `--accent`·`--secondary`가 샌다 — 셋은 값이 같아
  // (라이트 210 40% 96.1%) 대비도 똑같이 4.34:1인데 이름만 다르다. 값으로 판정한다.
  it("값이 같은 표면 토큰도 muted 표면으로 본다", () => {
    const light = parseTokens(GLOBALS, ":root");
    expect(light.secondary).toBe(light.muted);
    expect(light.accent).toBe(light.muted);
    for (const surface of ["bg-secondary", "bg-accent"]) {
      expect(offendingLiterals(`"${surface} text-muted-foreground"`, light, false)).toHaveLength(1);
    }
  });

  // `bg-*`가 전부 background-color인 건 아니다. 다른 프로퍼티(size·clip·image…)가 뒤에 오면
  // 표면 승자를 가로채 위반이 무음 통과한다 — 누락은 조용하고 오탐은 시끄럽다.
  it("색이 아닌 bg- 유틸리티는 표면 승자를 가로채지 않는다", () => {
    const light = parseTokens(GLOBALS, ":root");
    for (const trailing of ["bg-cover", "bg-clip-text", "bg-gradient-to-r", "bg-no-repeat"]) {
      expect(
        offendingLiterals(`"bg-muted text-muted-foreground ${trailing}"`, light, false),
        trailing,
      ).toHaveLength(1);
    }
    // 반대로 색을 실제로 덮는 유틸리티가 뒤에 오면 muted 표면이 아니다.
    expect(offendingLiterals('"bg-muted text-muted-foreground bg-transparent"', light, false)).toEqual([]);
  });

  // `dark:`는 "조건부"가 아니라 이 테스트가 순회하는 축 그 자체다. 다크 순회에서 안 보면
  // `dark:` 뒤에 숨은 글자색이 무음 통과한다.
  it("다크 순회에서 dark: 글자색을 판정한다", () => {
    const dark = parseTokens(GLOBALS, ".dark");
    const literal = '"bg-muted text-foreground/60 dark:text-muted-foreground/40"';
    // 라이트에선 dark: 선언이 없는 셈이라 통과한다.
    expect(offendingLiterals(literal, parseTokens(GLOBALS, ":root"), false)).toEqual([]);
    // 다크에선 그 override가 승자라 미달이 드러난다.
    expect(offendingLiterals(literal, dark, true)).toHaveLength(1);
  });

  // 파서가 살아 있어도 walk가 빈 배열을 내면 본 검사가 조용히 통과한다 — 디렉터리 이동이
  // 그 형태다. 대상 집합 자체를 앵커로 고정한다.
  it("스캔 대상이 비어 있지 않다 (앵커)", () => {
    const files = walkSources(SRC).filter((p) => !p.startsWith(OUT_OF_SCOPE));
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(THEMES)("%s에서 muted 표면 위 글자가 AA(4.5:1)를 넘는다", (_label, selector) => {
    const tokens = parseTokens(GLOBALS, selector);
    const offenders = walkSources(SRC)
      .filter((p) => !p.startsWith(OUT_OF_SCOPE))
      .flatMap((p) =>
        offendingLiterals(readFileSync(p, "utf8"), tokens, selector === ".dark").map(
          (c) => `${relToRepo(p)} → ${c}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
