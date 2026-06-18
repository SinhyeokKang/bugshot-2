// 사용자가 직접 첨부한 로컬 파일의 메타(Blob은 IndexedDB attachments store에, 메타만 session/IssueRecord).
export interface UserAttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}
