import { getInlineImage, blobToDataUrl } from "@/store/blob-db";

const INLINE_REF_RE = /!\[([^\]]*)\]\(inline:([^)]+)\)/g;

export function extractInlineRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const m of markdown.matchAll(INLINE_REF_RE)) {
    refs.add(m[2]);
  }
  return [...refs];
}

export function replaceInlineRefs(
  markdown: string,
  refToUrl: Map<string, string>,
): string {
  return markdown.replace(INLINE_REF_RE, (match, alt: string, refId: string) => {
    const url = refToUrl.get(refId);
    if (!url) return match;
    return `![${alt}](${url})`;
  });
}

export interface ResolvedImage {
  refId: string;
  dataUrl: string;
  blob: Blob;
}

export async function resolveInlineImages(
  markdown: string,
): Promise<{ resolved: string; images: ResolvedImage[] }> {
  const refIds = extractInlineRefs(markdown);
  if (refIds.length === 0) return { resolved: markdown, images: [] };

  const images: ResolvedImage[] = [];
  const refToUrl = new Map<string, string>();

  await Promise.all(
    refIds.map(async (refId) => {
      const blob = await getInlineImage(refId);
      if (!blob) return;
      const dataUrl = await blobToDataUrl(blob);
      images.push({ refId, dataUrl, blob });
      refToUrl.set(refId, dataUrl);
    }),
  );

  return { resolved: replaceInlineRefs(markdown, refToUrl), images };
}
