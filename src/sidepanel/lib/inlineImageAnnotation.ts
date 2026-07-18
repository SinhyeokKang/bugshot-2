import {
  hasInlineOrigin,
  getInlineImage,
  getInlineOrigin,
  saveInlineOrigin,
  saveInlineImage,
  deleteInlineOrigins,
  dataUrlToBlob,
} from "@/store/blob-db";

// 본문 삽입 이미지 어노테이션의 blob 스왑 로직. refId는 고정하고 inlineImages[refId]의 내용만
// 바꾼다 — markdown `inline:refId`·세션·prune·제출 경로가 전부 무변경으로 재사용된다.

/**
 * 어노테이션 결과를 표시 blob으로 교체한다. 최초 1회만 현재 원본을 백업(재어노테이션 시 원본 보존).
 * @returns 새 표시 blob
 */
export async function annotateInlineImage(
  refId: string,
  annotatedDataUrl: string,
): Promise<Blob> {
  if (!(await hasInlineOrigin(refId))) {
    // 백업이 없을 때만 현재 표시 blob을 원본으로 저장. null(유실)이면 백업 스킵 —
    // null을 origin으로 저장하면 이후 reset가 빈 원본으로 복원한다.
    const current = await getInlineImage(refId);
    if (current) await saveInlineOrigin(refId, current);
  }
  const blob = dataUrlToBlob(annotatedDataUrl);
  await saveInlineImage(refId, blob);
  return blob;
}

/**
 * 어노테이션 전 원본으로 복원한다.
 * @returns 복원된 원본 blob, 백업이 없으면 null(no-op)
 */
export async function resetInlineImage(refId: string): Promise<Blob | null> {
  const origin = await getInlineOrigin(refId);
  if (!origin) return null;
  await saveInlineImage(refId, origin);
  await deleteInlineOrigins([refId]);
  return origin;
}
