import { getInlineImage, blobToDataUrl } from "@/store/blob-db";

const INLINE_REF_RE = /!\[([^\]]*)\]\(inline:([^)]+)\)/g;

export function extractInlineRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const m of markdown.matchAll(INLINE_REF_RE)) {
    refs.add(m[2]);
  }
  return [...refs];
}

// alt까지 보존한 이미지 markdown을 등장 순서대로(중복 포함) 반환.
export function extractInlineImageMarkdown(markdown: string): string[] {
  return [...markdown.matchAll(INLINE_REF_RE)].map((m) => m[0]);
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

// enabled paragraph 섹션의 inline 이미지를 dataURL로 resolve한 새 섹션 맵 반환.
// IssuePreviewView(blob-db 미접근)에 넘길 표시·copy용 섹션을 만든다.
export async function resolveSectionImages(
  sections: Record<string, string>,
  sectionConfig: SectionFilter[],
): Promise<Record<string, string>> {
  const out = { ...sections };
  await Promise.all(
    sectionConfig
      .filter((s) => s.enabled && s.renderAs === "paragraph")
      .map(async (s) => {
        const raw = out[s.id];
        if (!raw?.includes("inline:")) return;
        out[s.id] = (await resolveInlineImages(raw)).resolved;
      }),
  );
  return out;
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
