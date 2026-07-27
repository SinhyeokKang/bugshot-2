import type {
  AiDraftSessionContext,
  AiDraftStyleElement,
} from "../buildAiDraftPrompt";
import { PROMPT_CAPS } from "./caps";
import { sameElementKey, type ElementKeyLike } from "@/lib/element-key";

export function resolveAiDraftStyleElements(
  ctx: AiDraftSessionContext,
): AiDraftStyleElement[] {
  const source =
    ctx.styleElements && ctx.styleElements.length > 0
      ? ctx.styleElements
      : ctx.selector && ctx.tagName
        ? [{
            selector: ctx.selector,
            tagName: ctx.tagName,
            diffs: ctx.diffs ?? [],
          }]
        : [];
  const caps = PROMPT_CAPS[ctx.caps.promptStyle];
  let remainingDiffs = caps.diffs;
  let remainingImages = ctx.caps.supportsImages ? caps.images : 0;
  let remainingImageChars = ctx.caps.supportsImages ? caps.imageChars : 0;

  return source.map((element) => {
    const diffs = element.diffs.slice(0, remainingDiffs);
    remainingDiffs -= diffs.length;
    const { beforeImage, afterImage, ...rest } = element;
    const takeImage = (image: string | null | undefined) => {
      if (
        !image ||
        remainingImages === 0 ||
        image.length > remainingImageChars
      ) {
        return undefined;
      }
      remainingImages -= 1;
      remainingImageChars -= image.length;
      return image;
    };
    const resolvedBefore = takeImage(beforeImage);
    const resolvedAfter = takeImage(afterImage);
    return {
      ...rest,
      diffs,
      ...(resolvedBefore ? { beforeImage: resolvedBefore } : {}),
      ...(resolvedAfter ? { afterImage: resolvedAfter } : {}),
    };
  });
}

export function describeAiDraftElementImages(
  elements: AiDraftStyleElement[],
  index: number,
): string | null {
  const element = elements[index];
  if (!element) return null;
  const offset =
    elements
      .slice(0, index)
      .reduce(
        (count, item) =>
          count + Number(!!item.beforeImage) + Number(!!item.afterImage),
        0,
      ) + 1;
  const labels = [
    element.beforeImage ? "before" : null,
    element.afterImage ? "after" : null,
  ].filter((label): label is string => !!label);
  if (labels.length === 0) return null;
  const end = offset + labels.length - 1;
  const range = offset === end ? `Image ${offset}` : `Images ${offset}-${end}`;
  return `${range}: ${labels.join(", ")}`;
}

export function selectAiDraftTokens<T>(
  tokens: T[],
  elements: AiDraftStyleElement[],
  selection: ElementKeyLike | null | undefined,
): T[] | undefined {
  return elements.length === 1 &&
    selection &&
    sameElementKey(elements[0], selection) &&
    tokens.length > 0
    ? tokens
    : undefined;
}
