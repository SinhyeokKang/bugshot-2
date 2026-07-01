import { useT } from "@/i18n";
import type { ActionEntry } from "@/types/action";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActionLogContent } from "./ActionLogContent";

interface ActionLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ActionEntry[];
  startedAt: number;
  attach?: boolean;
  onToggleAttach?: (attach: boolean) => void;
  attachDisabled?: boolean; // 버튼은 노출하되 비활성(예: trim 단계 — 첨부는 drafting에서)
  syncBaseMs?: number; // 상대 시각 0점(영상 모드면 videoStartedAt — 없으면 startedAt)
}

export function ActionLogPreviewDialog({
  open,
  onOpenChange,
  entries,
  startedAt,
  attach,
  onToggleAttach,
  attachDisabled,
  syncBaseMs,
}: ActionLogPreviewDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="action-log-preview-dialog"
        className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{t("actionLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <ActionLogContent entries={entries} startedAt={startedAt} syncBaseMs={syncBaseMs} />

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          {onToggleAttach && (
            <Button disabled={attachDisabled} onClick={() => { onToggleAttach(!attach); onOpenChange(false); }}>
              {attach ? t("common.detach") : t("common.attach")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
