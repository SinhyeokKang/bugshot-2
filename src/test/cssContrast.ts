import { readFileSync } from "node:fs";

// CSS 토큰 파싱 + WCAG 대비 계산. 대비를 재는 테스트가 둘(styles/tokens · styles/
// muted-surface-contrast)이라 계산을 각자 복제하면 한쪽만 강화된다(sourceFiles가 walk를
// 공용화한 것과 같은 이유). 두 테스트가 재는 **대상**은 다르다 — 전자는 CSS 선언, 후자는
// TSX의 Tailwind 클래스 — 지만 "hsl 삼중값 → 대비"라는 계산은 같다.

// `:root { --x: 0 0% 3.9%; }` 형태의 토큰 표를 뽑는다.
export function parseTokens(path: string, selector: string): Record<string, string> {
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
export function hsl(value: string): { h: number; s: number; l: number } {
  const [h, s, l] = value.split(/\s+/).map((p) => Number.parseFloat(p));
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): number[] {
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

function luminanceOf(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratioOf(a: number[], b: number[]): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastRatio(a: string, b: string): number {
  return ratioOf(hslToRgb(hsl(a)), hslToRgb(hsl(b)));
}

// 알파가 걸린 글자색의 실효 대비는 배경과 섞인 뒤에야 나온다.
//
// **합성은 sRGB에서 한다 — HSL 성분을 선형 보간하면 안 된다.** 브라우저가 `hsl(var(--x) / 0.6)`을
// RGBA로 변환한 뒤 sRGB에서 배경과 섞기 때문이고, 두 색의 채도가 갈리면 HSL 보간이 엉뚱하게
// 채도 높은 중간색을 만들어 **관대한 쪽으로** 어긋난다(라이트 `--foreground` 222.2°/84% ↔
// `--muted` 210°/40%에서 `/50`이 3.69:1인데 HSL 보간은 4.36:1 — AA 미달을 통과로 읽는다).
// 다크는 두 토큰이 무채색이라 어느 쪽이든 같은 값이 나와, 라이트에서만 드러나는 함정이다.
export function contrastOnSurface(fg: string, bg: string, alpha: number): number {
  const f = hslToRgb(hsl(fg));
  const b = hslToRgb(hsl(bg));
  return ratioOf(
    f.map((c, i) => c * alpha + b[i] * (1 - alpha)),
    b,
  );
}

// WCAG AA 본문 하한.
export const AA = 4.5;
