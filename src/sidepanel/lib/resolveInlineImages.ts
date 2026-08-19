import { getInlineImage, blobToDataUrl } from "@/store/blob-db";
import { INLINE_REF_RE } from "@/lib/inline-ref";

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

// data: URI 이미지가 클립보드 text/html에 하나라도 있으면 Notion·Slack·Jira가 붙여넣기를
// 통째로 거부한다 — 이미지만 빠지는 게 아니라 본문이 전부 사라진다(크기 무관, 실측 확인).
// 클라이언트 온리라 호스팅 URL을 만들 수 없으니 복사 경로는 이미지를 포기하고 본문을 살린다.
// stripInlineImageRefs와 달리 흔적을 남기는 건 무음 유실이 이 버그의 실패 모드였기 때문이고,
// 문구를 인자로 받는 건 이 모듈을 i18n 비의존으로 두려는 것이다.
// 치환값은 콜백으로 넘긴다 — 문자열로 주면 문구 안의 `$&`·`$1`이 특수 치환으로 해석된다.
export function placeholderInlineImages(markdown: string, placeholder: string): string {
  return markdown.replace(INLINE_REF_RE, () => placeholder);
}

// resolveSectionImages와 **같은 게이트**를 타야 한다 — 갈리면 복사본과 제출본의 섹션 처리
// 범위가 어긋난다. 동기인 건 IDB 왕복이 없어서고, 그 덕에 클릭 gesture window도 보존된다.
export function placeholderSectionImages(
  sections: Record<string, string>,
  sectionConfig: SectionFilter[],
  placeholder: string,
): Record<string, string> {
  const out = { ...sections };
  for (const s of sectionConfig) {
    if (!s.enabled || s.renderAs !== "paragraph") continue;
    const raw = out[s.id];
    if (!raw?.includes("inline:")) continue;
    out[s.id] = placeholderInlineImages(raw, placeholder);
  }
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
