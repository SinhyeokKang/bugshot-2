import { mergeStyleElements, type StyleElementContext } from "./buildIssueMarkdown";
import type { BufferedElement } from "@/store/editor-store";
import type { IssueRecord } from "@/store/issues-store";

export interface DraftStyleImages {
  before: string | null;
  after: string | null;
  buffered: { before: string | null; after: string | null }[];
}

// 저장된 draft(IssueRecord)의 bufferedElements + 현재 element를 라이브 mergeStyleElements와
// 동일 규칙(버퍼 먼저 → 현재 마지막, selector dedup, diff 0 제외)으로 병합한다. 라이브 세션과
// DraftDetailDialog 재편집의 렌더·재제출 본문이 같은 결과를 내도록 단일 출처로 위임.
export function resolveDraftStyleElements(
  issue: Pick<
    IssueRecord,
    | "selector"
    | "tagName"
    | "frameId"
    | "styleEdits"
    | "selectionSnapshot"
    | "bufferedElements"
  >,
  images: DraftStyleImages,
): StyleElementContext[] {
  const buffered: BufferedElement[] = (issue.bufferedElements ?? []).map((b, i) => ({
    selector: b.selector,
    tagName: b.tagName,
    frameId: b.frameId ?? 0,
    origin: b.origin ?? "",
    selectionSnapshot: b.selectionSnapshot,
    styleEdits: {
      classList: b.styleEdits.classList,
      inlineStyle: b.styleEdits.inlineStyle,
      text: b.styleEdits.text,
    },
    beforeImage: images.buffered[i]?.before ?? null,
    afterImage: images.buffered[i]?.after ?? null,
  }));

  const current =
    issue.selectionSnapshot && issue.styleEdits
      ? {
          selection: {
            selector: issue.selector ?? "",
            frameId: issue.frameId ?? 0,
            tagName: issue.tagName ?? "",
            classList: issue.selectionSnapshot.classList,
            computedStyles: issue.selectionSnapshot.computedStyles,
            specifiedStyles: issue.selectionSnapshot.specifiedStyles,
            text: issue.selectionSnapshot.text,
          },
          styleEdits: {
            classList: issue.styleEdits.classList,
            inlineStyle: issue.styleEdits.inlineStyle,
            text: issue.styleEdits.text,
          },
          before: images.before,
          after: images.after,
        }
      : null;

  return mergeStyleElements(buffered, current);
}
