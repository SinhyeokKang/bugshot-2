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

export function isCssDraftUnapplied(
  cssText: string | null | undefined,
  specifiedStyles: Record<string, string>,
  inlineStyle: Record<string, string>,
): boolean {
  if (cssText == null) return false;
  const result = evaluateCssDraft(cssText, specifiedStyles);
  if (result.status === "unapplied") return true;
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
