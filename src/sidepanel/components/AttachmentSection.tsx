import { Fragment, useRef } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import type { PlatformId } from "@/types/platform";
import type { UserAttachmentMeta } from "@/types/attachment";
import { CATEGORY_ICON } from "./AttachmentList";
import { fileCategory, fileExtLabel } from "@/sidepanel/lib/fileMeta";
import { formatBytes } from "@/sidepanel/lib/formatBytes";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_SIZE,
  PLATFORM_FILE_SIZE_LIMIT,
  checkAttachmentLimits,
  type TakeWithinLimitsResult,
} from "@/sidepanel/lib/attachmentLimits";

interface AttachmentSectionProps {
  attachments: UserAttachmentMeta[];
  platform: PlatformId;
  onAdd: (files: File[]) => Promise<TakeWithinLimitsResult>;
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

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    // 하드캡 적용은 store(onAdd)가 단일 출처. 드롭 사유만 result로 받아 안내(무음 드롭 방지).
    const { droppedCount, reason } = await onAdd(files);
    if (droppedCount > 0) {
      toast(
        reason === "total"
          ? t("attachment.limit.total", { max: formatBytes(MAX_TOTAL_ATTACHMENT_SIZE) })
          : t("attachment.limit.count", { max: MAX_ATTACHMENT_COUNT }),
      );
    }
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
      {attachments.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 px-3 py-3">
            {attachments.map((a, idx) => (
              <Fragment key={a.id}>
                {idx > 0 ? <Separator className="-mx-3" /> : null}
                <div data-testid="attachment-item" className="flex items-center gap-3">
                  <div className="shrink-0">{CATEGORY_ICON[fileCategory(a.contentType, a.filename)]}</div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{a.filename}</span>
                    <span className={`truncate text-sm ${oversize.has(a.id) ? "text-destructive" : "text-muted-foreground"}`}>
                      {oversize.has(a.id)
                        ? t("attachment.limit.oversize", { limit: formatBytes(PLATFORM_FILE_SIZE_LIMIT[platform] ?? 0) })
                        : `${fileExtLabel(a.filename)} · ${formatBytes(a.size)}`}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(a.id)}
                    title={t("attachment.remove")}
                    aria-label={t("attachment.remove")}
                    data-testid="attachment-remove"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Fragment>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
