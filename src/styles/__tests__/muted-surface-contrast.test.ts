import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { AA, contrastOnSurface, parseTokens } from "@/test/cssContrast";
import { relToRepo, walkSources } from "@/test/sourceFiles";

// 글자색의 대비는 토큰 이름이 아니라 "무슨 표면 위냐"가 정한다(DESIGN.md §2). `--muted-foreground`는
// `--background`(흰색) 위에선 4.76:1로 AA를 넘지만 `--muted` 위에선 4.34:1로 미달한다.
//
// **금지 목록이 아니라 계산으로 판정한다.** "muted-foreground를 쓰지 마라"로 두면 대체값이
// 무엇이든 통과해서, `text-foreground/60`을 `/50`으로 내리는(라이트 3.69:1) 회귀가 green으로
// 샌다 — 규칙의 본체는 토큰 이름이 아니라 하한이다.
//
// tokens.test.ts는 같은 계산을 **CSS 선언**에 적용한다(코드블럭 gutter). 여기는 TSX의 Tailwind
// 클래스가 대상이라 파서만 다르고, 계산은 `@/test/cssContrast`를 공유한다.
const GLOBALS = resolve(__dirname, "../globals.css");
const SCAN_ROOT = join(process.cwd(), "src");

// `src/components/ui/`는 shadcn CLI 생성물이라 우리 컨벤션의 대상이 아니다(CLAUDE.md 코드
// 컨벤션). **다만 이 제외가 "그 안은 전부 통과한다"는 뜻은 아니다** — 실측하면 조합이 넷이고
// 사정이 갈린다:
//   - `kbd.tsx`: 기본값으로 들지만 소비처 3곳이 전부 `ActionLogContent`의 CHIP_CLS
//     (`text-foreground`)로 덮는다 — 렌더 결과는 통과다(DESIGN.md §5).
//   - `tabs.tsx`(TabsList 비활성 라벨): **아무도 안 덮어 실제로 4.34:1로 렌더된다.** TabsList
//     소비처 9곳 중 글자색을 덮는 곳이 없다(`NetworkLogContent`만 `bg-transparent`로 표면을
//     없애 통과). shadcn 기본값을 덮는 판단이 필요해 이 변경의 범위 밖에 뒀다 — 미해결 1건이다.
//   - `sonner.tsx`의 cancelButton과 `toggle.tsx`의 segment variant: 조합은 있으나 소비처가
//     0건이라 렌더되지 않는다(sonner의 description은 `bg-background` 위라 4.75:1로 통과다).
// 즉 이 줄은 "안전해서 뺀 스코프"가 아니라 **미해결 1건을 담은 경계**다. 넓히면 `tabs.tsx`가
// red가 되고(`kbd.tsx`도 함께 — 스캐너는 리터럴만 보지 소비처의 override를 못 본다),
// `group-[.toast]:bg-muted`는 표면 판정이 정확 일치라 애초에 안 걸린다.
const OUT_OF_SCOPE = join(SCAN_ROOT, "components", "ui");

// 판정은 **문자열 리터럴 하나** 안에서 표면과 글자색이 만나는 형태만 본다. 조상이 깐 배경 위의
// 자식 텍스트나 `cn("bg-muted", cond && "text-foreground/60")`처럼 리터럴이 갈린 형태는 못 잡는다
// — 넓히면 오탐이 붙어 그물이 장부가 되므로, 실제 위반이 취하는 형태(className 리터럴 한 줄)에
// 맞춰 좁게 둔다. CSS 파일도 사정거리 밖이다(walkSources가 `.tsx?`만 훑는다) — 그쪽 축은
// tokens.test.ts가 파일을 지목해 잡는다.
//
// `bg-muted`는 정확 토큰만 표면으로 친다: `bg-muted/50`은 배경이 옅어져 대비가 오히려 오르고
// (라이트 4.54:1), `dark:bg-muted`는 라이트에서 muted 표면이 아니다.
const isMutedSurface = (token: string): boolean => token === "bg-muted";

// `text-foreground/60` → 토큰 `foreground` + 알파 0.6. variant가 붙은 건(`hover:`·`dark:`) 조건부라
// 보지 않고, globals.css에 없는 이름은 색 토큰이 아니므로(`text-sm`·`text-red-600`) 스킵된다.
function textToken(token: string, tokens: Record<string, string>): { name: string; alpha: number } | null {
  const m = /^text-([\w-]+)(?:\/(\d{1,3}))?$/.exec(token);
  if (!m || !(m[1] in tokens)) return null;
  return { name: m[1], alpha: m[2] ? Number(m[2]) / 100 : 1 };
}

// muted 표면을 스스로 깐 리터럴 중, 글자색 대비가 AA에 못 미치는 것들.
function offendingLiterals(src: string, tokens: Record<string, string>): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
    const parts = m[2].split(/\s+/).filter(Boolean);
    if (!parts.some(isMutedSurface)) continue;
    for (const part of parts) {
      const fg = textToken(part, tokens);
      if (!fg) continue;
      const ratio = contrastOnSurface(tokens[fg.name], tokens.muted, fg.alpha);
      if (ratio < AA) out.push(`${part} on bg-muted = ${ratio.toFixed(2)}:1`);
    }
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
    const scan = (s: string) => offendingLiterals(s, light);

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

  // 파서가 살아 있어도 walk가 빈 배열을 내면 본 검사가 조용히 통과한다 — 디렉터리 이동이
  // 그 형태다. 대상 집합 자체를 앵커로 고정한다.
  it("스캔 대상이 비어 있지 않다 (앵커)", () => {
    const files = walkSources(SCAN_ROOT).filter((p) => !p.startsWith(OUT_OF_SCOPE));
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(THEMES)("%s에서 muted 표면 위 글자가 AA(4.5:1)를 넘는다", (_label, selector) => {
    const tokens = parseTokens(GLOBALS, selector);
    const offenders = walkSources(SCAN_ROOT)
      .filter((p) => !p.startsWith(OUT_OF_SCOPE))
      .flatMap((p) =>
        offendingLiterals(readFileSync(p, "utf8"), tokens).map((c) => `${relToRepo(p)} → ${c}`),
      );
    expect(offenders).toEqual([]);
  });
});
