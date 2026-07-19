import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 토큰 표는 사이드패널(globals.css)과 다운로드되는 logs.html(log-viewer/styles.css)에
// 두 벌 존재한다. 별도 Vite 빌드라 서로를 모르고, 어긋나면 같은 제품이 두 톤으로 갈린다.
const GLOBALS = resolve(__dirname, "../globals.css");
const LOG_VIEWER = resolve(__dirname, "../../log-viewer/styles.css");
const TAILWIND_CONFIG = resolve(__dirname, "../../../tailwind.config.js");

function parseTokens(path: string, selector: string): Record<string, string> {
  const css = readFileSync(path, "utf8");
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${path}에 ${selector} 블록이 없다`);
  const end = css.indexOf("}", start);
  const body = css.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// tailwind.config.js는 JS인데 allowJs=false라 import하면 vitest는 통과해도 `pnpm typecheck`가
// TS7016으로 막는다(저장소에 @ts-expect-error 선례 0건). 그래서 위 parseTokens와 같은 기법을 쓴다.
// 주석을 먼저 걷어내고 따옴표 리터럴만 뽑으므로 배열 안 주석·prettier 리플로우에 안 깨진다.
function parseFontStack(key: string): string[] {
  const src = readFileSync(TAILWIND_CONFIG, "utf8").replace(/\/\/[^\n]*/g, "");
  const block = src.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
  if (!block) throw new Error(`tailwind.config.js에 fontFamily.${key} 배열이 없다`);
  return [...block[1].matchAll(/(['"])(.*?)\1/g)].map((m) => m[2].replace(/['"]/g, "").trim());
}

// mono 블록은 `.font-mono, pre, code, …` 멀티라인 셀렉터 리스트라 parseTokens로는 못 찾는다
// (완전 일치 문자열 검색 + `--` 커스텀 프로퍼티만 매칭). 주석을 먼저 걷어내야 주석 처리된 선언이
// 잡히지 않고, 중첩 브레이스를 못 넘는 [^{}] 덕에 @layer base 안쪽 규칙만 걸린다.
function parseRule(path: string, selector: string): { selectors: string[]; decls: Record<string, string> } {
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;
    const decls: Record<string, string> = {};
    for (const d of rule[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    return { selectors, decls };
  }
  throw new Error(`${path}에 ${selector}를 포함한 규칙이 없다`);
}

// hsl 삼중값("0 0% 3.9%") → 성분.
function hsl(value: string): { h: number; s: number; l: number } {
  const [h, s, l] = value.split(/\s+/).map((p) => Number.parseFloat(p));
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): number[] {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const base =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = lig - c / 2;
  return base.map((v) => v + m);
}

function relativeLuminance(value: string): number {
  const [r, g, b] = hslToRgb(hsl(value)).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// 기능색(destructive)은 빨강이어야 하므로 채도 검사 대상에서 제외. radius는 색이 아니다.
// 정확 일치라 --destructive-foreground는 제외되지 **않는데**, 이게 의도다 — 그건 빨강이 아니라
// 거의 흰 글자색이라 base 팔레트를 따라야 한다(라이트 210 40% 98% 틴트 / 다크 0 0% 98% 무채색).
// startsWith로 "고치면" 이 토큰이 검사에서 빠진다.
const CHROMATIC = ["destructive"];
const NON_COLOR = ["radius"];

function grayTokens(tokens: Record<string, string>): [string, string][] {
  return Object.entries(tokens).filter(
    ([name]) => !CHROMATIC.includes(name) && !NON_COLOR.includes(name),
  );
}

describe("디자인 토큰 표", () => {
  describe("두 파일 동기화 (globals.css ↔ log-viewer/styles.css)", () => {
    it("라이트(:root) 토큰 표가 완전히 같다", () => {
      expect(parseTokens(LOG_VIEWER, ":root")).toEqual(parseTokens(GLOBALS, ":root"));
    });

    it("다크(.dark) 토큰 표가 완전히 같다", () => {
      expect(parseTokens(LOG_VIEWER, ".dark")).toEqual(parseTokens(GLOBALS, ".dark"));
    });
  });

  // 테마별로 base가 다른 건 의도다(라이트=slate 틴트 / 다크=neutral 무채색) — 같은 채도가
  // 고명도에선 "맑음", 저명도에선 배경을 남색으로 물들여 "칙칙함"으로 읽히기 때문.
  // 표만 보면 갈린 게 실수처럼 보여 "일관성" 명목으로 한쪽을 밀기 쉬워서, 여기서 양방향으로 막는다.
  describe("테마별 base 비대칭 (라이트=slate / 다크=neutral)", () => {
    it("라이트 회색 토큰은 틴트를 유지한다 (순백 표면은 틴트 여지가 없어 제외)", () => {
      const flattened = grayTokens(parseTokens(GLOBALS, ":root"))
        .filter(([, v]) => hsl(v).l < 100 && hsl(v).s === 0)
        .map(([name, v]) => `--${name}: ${v}`);
      expect(flattened).toEqual([]);
    });

    it("다크 회색 토큰은 채도가 0이다", () => {
      const tinted = grayTokens(parseTokens(GLOBALS, ".dark"))
        .filter(([, v]) => hsl(v).s !== 0)
        .map(([name, v]) => `--${name}: ${v}`);
      expect(tinted).toEqual([]);
    });
  });

  // .font-mono 유틸리티는 tailwind.config.js를 공유해 사이드패널과 log-viewer 두 빌드에 똑같이
  // 나가는데, @font-face는 globals.css의 @import로만 들어와 사이드패널에만 있다. 즉 log-viewer는
  // 항상 폴백에 착지한다 — 이 폴백이 유일한 안전망이라, 스택을 Geist 하나로 "정리"하면 내보낸
  // logs.html의 코드가 깨진다. (globals.css의 @layer base 규칙은 log-viewer가 자체 styles.css를
  // 쓰므로 안 나간다 — 폰트 스택과 달리 그쪽엔 공유되지 않는다.)
  describe("mono 폰트 스택 폴백 (log-viewer는 @font-face가 없다)", () => {
    it("Geist 뒤에 시스템 폴백이 남아 있다", () => {
      expect(parseFontStack("mono").length).toBeGreaterThan(1);
    });

    it("제네릭 monospace로 끝난다", () => {
      const mono = parseFontStack("mono");
      expect(mono[mono.length - 1]).toBe("monospace");
    });
  });

  // Geist를 받는 경로가 둘이다 — .font-mono 유틸(CSS 뷰·DOM 트리·로그 12곳)과 Tailwind preflight의
  // pre/code(Tiptap·프리뷰 코드블럭). 만나는 지점이 없어 한쪽만 손대면 조용히 갈라진다(v1.6.0이
  // 13px 통일을 선언하고 Tiptap을 놓친 이유). 그래서 두 경로를 한 셀렉터 리스트로 묶어 튜닝한다.
  describe("mono 타이포그래피 (진입 경로가 둘이라 한 블록으로 묶는다)", () => {
    // 새 파서를 기존 규칙으로 먼저 검증한다 — 파서가 조용히 빈 객체를 내면 아래 단언들이
    // 전부 공허해진다(POSTMORTEM 2026-07-16 "파서를 새로 쓰면 기존 배열로 먼저 검증한다").
    it("parseRule이 기존 규칙을 읽는다 (파서 자기검증)", () => {
      expect(parseRule(GLOBALS, "::-webkit-scrollbar").decls).toMatchObject({
        width: "10px",
        height: "10px",
      });
    });

    it("리거처를 끈다 — Geist의 liga가 `--`를 한 글리프로 잇는다", () => {
      expect(parseRule(GLOBALS, ".font-mono").decls["font-variant-ligatures"]).toBe("none");
    });

    // font-variant-ligatures가 정확한 도구다 — font-feature-settings는 가산이 아니라 통째로
    // 덮어쓴다. 실측하면 지금은 잃을 게 없다(preflight가 이미 pre/code에 font-feature-settings:
    // normal을 직접 걸고, .font-mono의 비-pre 표면은 전부 rlig/calt가 없는 Geist Mono다).
    // 즉 이건 실손실 방어가 아니라 형태 예방이고, 그래서 근거를 사실대로 적어둔다 —
    // sans 폰트를 바꾸거나 이 리스트가 넓어지면 그때 실제 손실이 생긴다.
    it("font-feature-settings로 끄지 않는다 (가산이 아니라 통째로 덮어쓴다)", () => {
      expect(parseRule(GLOBALS, ".font-mono").decls).not.toHaveProperty("font-feature-settings");
    });

    it("셀렉터 리스트에 .font-mono와 pre가 둘 다 있다 (한쪽만이면 경로가 갈린다)", () => {
      expect(parseRule(GLOBALS, ".font-mono").selectors).toEqual(expect.arrayContaining([".font-mono", "pre"]));
    });

    // log-viewer는 globals.css를 import하지 못하는 별도 빌드인데, App.tsx가 NetworkLogContent·
    // ConsoleLogContent·IssuePreviewView를 사이드패널에서 그대로 가져다 써서 mono 표면이 있다.
    // 폰트 스택 1순위가 "Geist Mono Variable"이라 그 폰트를 시스템에 설치한 사용자(=개발자·QA)는
    // @font-face 없이도 로컬 해석으로 Geist를 받아 liga가 살아난다 — 내보낸 logs.html의 네트워크
    // 본문에서 `------WebKitFormBoundary`가 이어붙는다. 사이드패널은 늘 Geist라 개발 중엔 안 보인다.
    it("log-viewer에도 같은 mono 블록이 있다 (별도 빌드라 globals.css가 안 나간다)", () => {
      expect(parseRule(LOG_VIEWER, ".font-mono")).toEqual(parseRule(GLOBALS, ".font-mono"));
    });
  });

  describe("destructive 대비", () => {
    // 앱에서 --destructive는 text-destructive/destructive-outline로만 소비된다
    // (variant="destructive"의 bg-destructive는 미사용). 즉 글자색 기준 대비가 필요하다.
    it("다크에서 destructive 글자가 배경 대비 WCAG AA(4.5:1)를 넘는다", () => {
      const dark = parseTokens(GLOBALS, ".dark");
      expect(contrastRatio(dark.destructive, dark.background)).toBeGreaterThanOrEqual(4.5);
    });

    it("라이트에서 destructive 글자가 배경 대비 WCAG AA(4.5:1)를 넘는다", () => {
      const light = parseTokens(GLOBALS, ":root");
      expect(contrastRatio(light.destructive, light.background)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
