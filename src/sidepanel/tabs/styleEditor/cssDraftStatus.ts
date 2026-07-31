import { filterValidCssDeclarations } from "@/sidepanel/lib/cssDeclaration";
import {
  collapseTrbl,
  computeOverrides,
  expandTrbl,
  parseCssBlockDraft,
  serializeCssBlock,
} from "./cssBlock";

export type CssDraftEvaluation =
  | { status: "unapplied" }
  | {
      status: "applied";
      overrides: Record<string, string>;
      cssText: string;
      canonicalized: boolean;
    };

export function evaluateCssDraft(
  cssText: string,
  specifiedStyles: Record<string, string>,
  supports?: (property: string, value: string) => boolean,
): CssDraftEvaluation {
  const parsed = parseCssBlockDraft(cssText);
  if (!parsed.valid) return { status: "unapplied" };
  const valid = filterValidCssDeclarations(parsed.declarations, supports);
  if (Object.keys(valid).length !== Object.keys(parsed.declarations).length) {
    return { status: "unapplied" };
  }
  const specifiedLong = expandTrbl(specifiedStyles);
  const editedLong = expandTrbl(valid);
  const overrides = computeOverrides(editedLong, specifiedLong);
  const canonicalized = Object.keys(specifiedLong).some(
    (property) => !(property in editedLong),
  );
  const canonical = serializeCssBlock(
    cssText.slice(0, cssText.indexOf("{")).trim(),
    collapseTrbl({ ...specifiedLong, ...overrides }),
  );
  return {
    status: "applied",
    overrides,
    cssText: canonicalized ? canonical : cssText,
    canonicalized,
  };
}

// 블록 본문의 마지막 선언 조각을 떼어낸 draft. 없으면 null.
function withoutTrailingDeclaration(cssText: string): string | null {
  const open = cssText.indexOf("{");
  const close = cssText.lastIndexOf("}");
  if (open === -1 || close <= open) return null;
  // 끝 공백·개행을 먼저 떼지 않으면 잘라낼 조각이 그 개행 하나뿐이라 draft가 그대로 남는다.
  const body = cssText.slice(open + 1, close).replace(/\s+$/, "");
  const cut = Math.max(body.lastIndexOf(";"), body.lastIndexOf("\n"));
  const kept = cut === -1 ? "" : body.slice(0, cut + 1);
  if (kept === body) return null;
  return cssText.slice(0, open + 1) + kept + cssText.slice(close);
}

export function isCssDraftUnapplied(
  cssText: string | null | undefined,
  specifiedStyles: Record<string, string>,
  inlineStyle: Record<string, string>,
): boolean {
  if (cssText == null) return false;
  const result = evaluateCssDraft(cssText, specifiedStyles);
  if (result.status === "unapplied") {
    // CodeMirror onChange는 디바운스가 없어 키스트로크마다 평가된다. 마지막 조각만 빼면
    // 멀쩡한 draft라면 그건 사용자가 지금 치고 있는 줄이라 경고 대상이 아니다 —
    // 안 그러면 속성명 한 글자마다 배너가 붙었다 떨어지고 전환 버튼이 잠겼다 풀린다.
    // 중복 선언·닫히지 않은 괄호는 앞줄까지 망가뜨리므로 이 완화에 걸리지 않는다.
    const trimmed = withoutTrailingDeclaration(cssText);
    if (trimmed == null) return true;
    return isCssDraftUnapplied(trimmed, specifiedStyles, inlineStyle);
  }
  const actual = Object.entries(inlineStyle);
  const expected = Object.entries(result.overrides);
  return (
    actual.length !== expected.length ||
    expected.some(([property, value]) => inlineStyle[property] !== value)
  );
}

export function hasUnappliedCssDrafts(
  entries: Array<{
    cssText?: string | null;
    specifiedStyles: Record<string, string>;
    inlineStyle: Record<string, string>;
  }>,
): boolean {
  return entries.some((entry) =>
    isCssDraftUnapplied(
      entry.cssText,
      entry.specifiedStyles,
      entry.inlineStyle,
    ),
  );
}
