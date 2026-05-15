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

export interface InlineImageInput {
  refId: string;
  dataUrl: string;
}

export interface SectionFilter {
  id: string;
  enabled: boolean;
  renderAs: string;
}

export async function resolveInlineImagesForSections(
  sections: Record<string, string>,
  sectionConfig: SectionFilter[],
): Promise<InlineImageInput[]> {
  const allContent = sectionConfig
    .filter((s) => s.enabled && s.renderAs === "paragraph")
    .map((s) => sections[s.id] ?? "")
    .join("\n");
  const refIds = extractInlineRefs(allContent);
  if (refIds.length === 0) return [];
  const results: InlineImageInput[] = [];
  await Promise.all(
    refIds.map(async (refId) => {
      const blob = await getInlineImage(refId);
      if (!blob) return;
      const dataUrl = await blobToDataUrl(blob);
      results.push({ refId, dataUrl });
    }),
  );
  return results;
}

export interface MarkdownSections {
  [key: string]: string;
}

export function resolveCtxInlineImages<T extends { sections: MarkdownSections }>(
  ctx: T,
  inlineImages: InlineImageInput[],
): T {
  if (inlineImages.length === 0) return ctx;
  const refToUrl = new Map(inlineImages.map((img) => [img.refId, img.dataUrl]));
  return {
    ...ctx,
    sections: Object.fromEntries(
      Object.entries(ctx.sections).map(([k, v]) => [k, replaceInlineRefs(v, refToUrl)]),
    ),
  };
}

export function stripInlineImageRefs(markdown: string): string {
  return markdown.replace(INLINE_REF_RE, "").replace(/\n{3,}/g, "\n\n").trim();
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
