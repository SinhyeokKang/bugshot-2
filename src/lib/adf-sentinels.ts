export const IMAGE_PLACEHOLDER = "__BUGSHOT_IMAGE__";
export const VIDEO_PLACEHOLDER = "__BUGSHOT_VIDEO__";
export const INLINE_IMAGE_PREFIX = "__BUGSHOT_INLINE:";

export function inlineImagePlaceholder(refId: string): string {
  return `${INLINE_IMAGE_PREFIX}${refId}__`;
}

export function parseInlinePlaceholder(text: string): string | null {
  if (!text.startsWith(INLINE_IMAGE_PREFIX) || !text.endsWith("__")) return null;
  return text.slice(INLINE_IMAGE_PREFIX.length, -2);
}
