import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// 글자색의 대비는 토큰 이름이 아니라 "무슨 표면 위냐"가 정한다(DESIGN.md §2).
// `--muted-foreground`는 `--background`(흰색) 위에선 4.76:1로 AA를 넘지만 `--muted` 위에선
// 4.34:1로 미달한다. 그래서 muted 표면을 스스로 깐 요소가 muted-foreground를 함께 들면 안 된다.
//
// tokens.test.ts는 CSS 토큰 **값**을 대조하는 그물이라 이 조합을 못 본다(양쪽 값이 다 정상인데
// 조합만 틀린 형태다). 값 축이 아니라 사용 축이므로 파일을 나눈다.
//
// 스코프에서 `src/components/ui/`를 빼는 근거: shadcn CLI 생성물이라 우리 컨벤션의 대상이
// 아니고(CLAUDE.md 코드 컨벤션), `kbd.tsx`가 이 조합을 **기본값**으로 들고 소비처가
// `text-foreground`로 덮는 구조가 DESIGN.md §5에 문서화돼 있다. 예외 목록이 아니라 스코프다 —
// 그 디렉터리를 뺀 나머지는 지금 0건이라 래칫으로 잠글 수 있다.
const SCAN_ROOT = join(process.cwd(), "src");
const OUT_OF_SCOPE = join(SCAN_ROOT, "components", "ui");

// 판정은 **문자열 리터럴 하나** 안에서 두 토큰이 만나는 형태만 본다. 조상이 깐 배경 위의
// 자식 텍스트나 `cn("bg-muted", cond && "text-muted-foreground")`처럼 리터럴이 갈린 형태는
// 못 잡는다 — 넓히면 오탐이 붙어 그물이 장부가 되므로, 실제 위반이 취하는 형태(className
// 리터럴 한 줄)에 맞춰 좁게 둔다.
//
// `bg-muted`는 정확 토큰만 센다(`bg-muted/50`은 표면이 옅어져 대비 계산이 달라지고,
// `dark:bg-muted`는 라이트에서 muted 표면이 아니다). 반대로 글자색은 알파를 깐
// `text-muted-foreground/70`이 더 낮은 대비이므로 함께 센다.
const isMutedSurface = (token: string): boolean => token === "bg-muted";
const isMutedForeground = (token: string): boolean =>
  token === "text-muted-foreground" || token.startsWith("text-muted-foreground/");

function mutedOnMuted(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
    const tokens = m[2].split(/\s+/).filter(Boolean);
    if (tokens.some(isMutedSurface) && tokens.some(isMutedForeground)) out.push(m[2].trim());
  }
  return out;
}

describe("muted 표면 위 글자색", () => {
  // 스코프 밖을 걷어내면 위반이 0건이라, 정규식이 통째로 망가져도 본 검사는 green이다.
  // 스캐너가 실제로 무언가를 잡는다는 것 자체를 고정한다.
  it("스캐너가 위반을 잡는다 (자기검증 앵커)", () => {
    expect(mutedOnMuted('className="w-24 text-sm text-muted-foreground bg-muted"')).toEqual([
      "w-24 text-sm text-muted-foreground bg-muted",
    ]);
    // 알파를 깐 글자색은 대비가 더 낮으므로 함께 잡는다.
    expect(mutedOnMuted('"bg-muted text-muted-foreground/70"')).toHaveLength(1);
    // 옅은 표면·다크 한정 표면은 라이트 muted 표면이 아니다.
    expect(mutedOnMuted('"bg-muted/50 text-muted-foreground"')).toEqual([]);
    expect(mutedOnMuted('"dark:bg-muted text-muted-foreground"')).toEqual([]);
    // 권장 대체형은 통과해야 한다.
    expect(mutedOnMuted('"bg-muted text-foreground/60"')).toEqual([]);
    // 리터럴이 다르면 (한계대로) 잡지 않는다.
    expect(mutedOnMuted('cn("bg-muted", "text-muted-foreground")')).toEqual([]);
  });

  // 정규식이 살아 있어도 walk가 빈 배열을 내면 본 검사가 조용히 통과한다 — 디렉터리 이동이
  // 그 형태다. 대상 집합 자체를 앵커로 고정한다.
  it("스캔 대상이 비어 있지 않다 (앵커)", () => {
    const files = walkSources(SCAN_ROOT).filter((p) => !p.startsWith(OUT_OF_SCOPE));
    expect(files.length).toBeGreaterThan(100);
  });

  it("muted 표면을 깐 요소가 text-muted-foreground를 함께 쓰지 않는다", () => {
    const offenders = walkSources(SCAN_ROOT)
      .filter((p) => !p.startsWith(OUT_OF_SCOPE))
      .flatMap((p) => mutedOnMuted(readFileSync(p, "utf8")).map((c) => `${relToRepo(p)} → ${c}`));
    expect(offenders).toEqual([]);
  });
});
