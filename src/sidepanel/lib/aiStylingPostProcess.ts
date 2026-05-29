import type { EditorStyleEdits } from "@/store/editor-store";
import type { Token } from "@/types/picker";
import type { AiStylingEdits } from "./buildAiStylingPrompt";
import { tokenFamilyPrefix } from "@/sidepanel/tabs/styleEditor/tokenUtils";

export function mergeAiEdits(
  current: EditorStyleEdits,
  edits: AiStylingEdits,
): EditorStyleEdits {
  return {
    inlineStyle: { ...current.inlineStyle, ...(edits.inlineStyle ?? {}) },
    classList: edits.classList ?? current.classList,
    text: current.text,
  };
}

export function replaceRawWithTokens(
  inlineStyle: Record<string, string>,
  tokens: Token[],
  specifiedStyles: Record<string, string>,
): Record<string, string> {
  const familyPrefixes = extractFamilyPrefixes(specifiedStyles, tokens);
  const result: Record<string, string> = {};

  for (const [prop, val] of Object.entries(inlineStyle)) {
    if (val.includes("var(")) {
      result[prop] = val;
      continue;
    }
    const familyMatch = findTokenByValue(tokens, val, familyPrefixes);
    const match = familyMatch ?? findTokenByValue(tokens, val, null);
    result[prop] = match ? `var(${match.name})` : val;
  }

  return result;
}

const COLOR_FUZZY_THRESHOLD = 50;

function findTokenByValue(
  tokens: Token[],
  value: string,
  prefixes: string[] | null,
): Token | undefined {
  const candidates = prefixes
    ? tokens.filter((t) => prefixes.some((p) => t.name.startsWith(p)))
    : tokens;

  const exact = candidates.find((t) => t.value === value);
  if (exact) return exact;

  if (!prefixes) return undefined;

  const hsl = parseColorToHsl(value);
  if (!hsl) return undefined;

  let best: Token | undefined;
  let bestDist = Infinity;
  for (const t of candidates) {
    if (t.category !== "color") continue;
    const tHsl = parseColorToHsl(t.value);
    if (!tHsl) continue;
    const dist = hslDistance(hsl, tHsl);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best && bestDist <= COLOR_FUZZY_THRESHOLD ? best : undefined;
}

type RGB = [number, number, number];
type HSL = [number, number, number];

function parseColorToHsl(value: string): HSL | null {
  const rgb = parseColorToRgb(value);
  if (!rgb) return null;
  return rgbToHsl(rgb);
}

function parseColorToRgb(value: string): RGB | null {
  const hex = parseHex(value);
  if (hex) return hex;

  const rgbMatch = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/,
  );
  if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];

  return NAMED_COLORS[value.toLowerCase()] ?? null;
}

function parseHex(value: string): RGB | null {
  const m = value.match(/^#([0-9a-fA-F]+)$/);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6 && hex.length !== 8) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function rgbToHsl([r, g, b]: RGB): HSL {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) * 60;
  else if (max === g1) h = ((b1 - r1) / d + 2) * 60;
  else h = ((r1 - g1) / d + 4) * 60;
  return [h, s, l];
}

function hslDistance(a: HSL, b: HSL): number {
  if (a[1] < 0.1 || b[1] < 0.1) return Infinity;
  return Math.min(Math.abs(a[0] - b[0]), 360 - Math.abs(a[0] - b[0]));
}

function extractFamilyPrefixes(
  specifiedStyles: Record<string, string>,
  tokens: Token[],
): string[] {
  const prefixes: string[] = [];
  for (const val of Object.values(specifiedStyles)) {
    const refs = val.match(/var\(\s*(--[^\s,)]+)/g);
    if (!refs) continue;
    for (const ref of refs) {
      const name = ref.replace(/var\(\s*/, "");
      const prefix = tokenFamilyPrefix(name, tokens);
      if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix);
    }
  }
  return prefixes;
}

const NAMED_COLORS: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  lime: [0, 255, 0],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  aqua: [0, 255, 255],
  silver: [192, 192, 192],
  coral: [255, 127, 80],
  salmon: [250, 128, 114],
  tomato: [255, 99, 71],
  gold: [255, 215, 0],
  crimson: [220, 20, 60],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  khaki: [240, 230, 140],
  beige: [245, 245, 220],
  tan: [210, 180, 140],
  ivory: [255, 255, 240],
  plum: [221, 160, 221],
  peru: [205, 133, 63],
  sienna: [160, 82, 45],
  orchid: [218, 112, 214],
  turquoise: [64, 224, 208],
  chocolate: [210, 105, 30],
  firebrick: [178, 34, 34],
  steelblue: [70, 130, 180],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  darkred: [139, 0, 0],
  darkgreen: [0, 100, 0],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  darkmagenta: [139, 0, 139],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dodgerblue: [30, 144, 255],
  hotpink: [255, 105, 180],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightpink: [255, 182, 193],
  lightyellow: [255, 255, 224],
  limegreen: [50, 205, 50],
  mediumblue: [0, 0, 205],
  royalblue: [65, 105, 225],
  skyblue: [135, 206, 235],
  springgreen: [0, 255, 127],
  yellowgreen: [154, 205, 50],
  whitesmoke: [245, 245, 245],
};
