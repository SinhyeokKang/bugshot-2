import {
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";
import type { UserAttachmentMeta } from "@/types/attachment";
import { fileCategory, fileExtLabel, type FileCategory } from "@/sidepanel/lib/fileMeta";
import { formatBytes } from "@/sidepanel/lib/formatBytes";

export const CATEGORY_ICON: Record<FileCategory, React.ReactNode> = {
  image: <FileImage className="h-4 w-4" />,
  video: <FileVideo className="h-4 w-4" />,
  audio: <FileAudio className="h-4 w-4" />,
  pdf: <FileText className="h-4 w-4" />,
  archive: <FileArchive className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  file: <File className="h-4 w-4" />,
};

// 읽기 전용 첨부 카드 목록 — 카드를 클릭하면 onDownload로 로컬 다시 받기. preview·초안 상세 공용.
export function AttachmentList({
  attachments,
  onDownload,
}: {
  attachments: UserAttachmentMeta[];
  onDownload: (meta: UserAttachmentMeta) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      {attachments.map((a) => (
        <Card
          key={a.id}
          role="button"
          tabIndex={0}
          onClick={() => onDownload(a)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onDownload(a);
            }
          }}
          title={t("attachment.download")}
          className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50"
          data-testid="attachment-item"
        >
          <div className="shrink-0">{CATEGORY_ICON[fileCategory(a.contentType, a.filename)]}</div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{a.filename}</span>
            <span className="truncate text-sm text-muted-foreground">
              {fileExtLabel(a.filename)} · {formatBytes(a.size)}
            </span>
          </div>
          <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Card>
      ))}
    </div>
  );
}
