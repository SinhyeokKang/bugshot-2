import { useRef } from "react";
import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Paperclip,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";
import type { PlatformId } from "@/types/platform";
import type { UserAttachmentMeta } from "@/types/attachment";
import { fileCategory, fileExtLabel, type FileCategory } from "@/sidepanel/lib/fileMeta";
import { formatBytes } from "@/sidepanel/lib/formatBytes";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_SIZE,
  PLATFORM_FILE_SIZE_LIMIT,
  checkAttachmentLimits,
  takeWithinLimits,
} from "@/sidepanel/lib/attachmentLimits";

const CATEGORY_ICON: Record<FileCategory, React.ReactNode> = {
  image: <FileImage className="h-4 w-4" />,
  video: <FileVideo className="h-4 w-4" />,
  audio: <FileAudio className="h-4 w-4" />,
  pdf: <FileText className="h-4 w-4" />,
  archive: <FileArchive className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  file: <File className="h-4 w-4" />,
};

interface AttachmentSectionProps {
  attachments: UserAttachmentMeta[];
  platform: PlatformId;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}

export function AttachmentSection({
  attachments,
  platform,
  onAdd,
  onRemove,
}: AttachmentSectionProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const atMax = attachments.length >= MAX_ATTACHMENT_COUNT;
  const { oversizeIds } = checkAttachmentLimits(attachments, platform);
  const oversize = new Set(oversizeIds);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    // store와 동일한 하드캡을 미리 적용해 드롭 사유를 사용자에게 안내(무음 드롭 방지).
    const { droppedCount, reason } = takeWithinLimits(
      attachments,
      files.map((f) => ({ size: f.size })),
    );
    if (droppedCount > 0) {
      toast(
        reason === "total"
          ? t("attachment.limit.total", { max: formatBytes(MAX_TOTAL_ATTACHMENT_SIZE) })
          : t("attachment.limit.count", { max: MAX_ATTACHMENT_COUNT }),
      );
    }
    onAdd(files);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="attachment-input"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        disabled={atMax}
        onClick={() => inputRef.current?.click()}
        data-testid="attachment-add"
      >
        <Paperclip className="h-4 w-4" />
        {t("attachment.button", { count: attachments.length, max: MAX_ATTACHMENT_COUNT })}
      </Button>
      {atMax && (
        <p className="text-sm text-muted-foreground">
          {t("attachment.limit.count", { max: MAX_ATTACHMENT_COUNT })}
        </p>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-col gap-2">
          {attachments.map((a) => (
            <Card
              key={a.id}
              data-testid="attachment-item"
              className={`flex items-center gap-3 p-3 ${oversize.has(a.id) ? "border-destructive" : ""}`}
            >
              <div className="shrink-0">{CATEGORY_ICON[fileCategory(a.contentType, a.filename)]}</div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{a.filename}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {oversize.has(a.id)
                    ? t("attachment.limit.oversize", { limit: formatBytes(PLATFORM_FILE_SIZE_LIMIT[platform] ?? 0) })
                    : `${fileExtLabel(a.filename, a.contentType)} · ${formatBytes(a.size)}`}
                </span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => onRemove(a.id)}
                title={t("attachment.remove")}
                aria-label={t("attachment.remove")}
                data-testid="attachment-remove"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
