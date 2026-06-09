import { useEffect, useState } from "react";
import type { IssueRecord } from "@/store/issues-store";
import { getImageBlob, blobToDataUrl } from "@/store/blob-db";
import {
  resolveDraftStyleElements,
  type DraftStyleImages,
} from "@/sidepanel/lib/resolveDraftStyleElements";
import type { StyleElementContext } from "@/sidepanel/lib/buildIssueMarkdown";

async function toDataUrl(blob: Blob | null): Promise<string | null> {
  return blob ? await blobToDataUrl(blob) : null;
}

// 저장된 draft의 현재 + 버퍼 element 이미지를 모두 dataURL로 로드(렌더·재제출 공용).
export async function loadDraftStyleImages(issue: IssueRecord): Promise<DraftStyleImages> {
  const before = await toDataUrl(
    issue.snapshot.before ? await getImageBlob(issue.id, "before") : null,
  );
  const after = await toDataUrl(
    issue.snapshot.after ? await getImageBlob(issue.id, "after") : null,
  );
  const buffered = await Promise.all(
    (issue.bufferedElements ?? []).map(async (b, i) => ({
      before: await toDataUrl(b.hasBefore ? await getImageBlob(issue.id, `b${i}-before`) : null),
      after: await toDataUrl(b.hasAfter ? await getImageBlob(issue.id, `b${i}-after`) : null),
    })),
  );
  return { before, after, buffered };
}

// 다이얼로그 렌더용. dataURL이라 <img src>에 바로 쓰며 objectURL revoke 불필요.
export function useDraftStyleElements(
  issue: IssueRecord | null,
  enabled: boolean,
): StyleElementContext[] {
  const [elements, setElements] = useState<StyleElementContext[]>([]);
  useEffect(() => {
    if (!issue || !enabled) {
      setElements([]);
      return;
    }
    let cancelled = false;
    loadDraftStyleImages(issue).then((images) => {
      if (!cancelled) setElements(resolveDraftStyleElements(issue, images));
    });
    return () => {
      cancelled = true;
    };
    // 한 draft record의 버퍼·이미지는 저장 후 불변이라 id 기준으로만 재로드.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, enabled]);
  return elements;
}
