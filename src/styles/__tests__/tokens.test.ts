import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 토큰 표는 사이드패널(globals.css)과 다운로드되는 logs.html(log-viewer/styles.css)에
// 두 벌 존재한다. 별도 Vite 빌드라 서로를 모르고, 어긋나면 같은 제품이 두 톤으로 갈린다.
const GLOBALS = resolve(__dirname, "../globals.css");
const LOG_VIEWER = resolve(__dirname, "../../log-viewer/styles.css");

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
