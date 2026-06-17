import { getAttachmentBlob } from "@/store/blob-db";
import type { UserAttachmentMeta } from "@/types/attachment";

// 첨부 Blob을 IndexedDB에서 꺼내 로컬로 다시 받게 한다. owner는 confirm 후 issueId,
// confirm 직후 rekey 레이스를 대비해 fallbackOwner(pending:${tabId})를 옵션으로 받는다.
export async function downloadAttachment(
  owner: string,
  meta: UserAttachmentMeta,
  fallbackOwner?: string,
): Promise<boolean> {
  let blob = await getAttachmentBlob(owner, meta.id);
  if (!blob && fallbackOwner) blob = await getAttachmentBlob(fallbackOwner, meta.id);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = meta.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
