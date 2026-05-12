import { useT } from "@/i18n";
import type { ConsoleEntry } from "@/types/console";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConsoleLogContent } from "./ConsoleLogContent";

interface ConsoleLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ConsoleEntry[];
  startedAt: number;
  attach?: boolean;
  onToggleAttach?: (attach: boolean) => void;
}

export function ConsoleLogPreviewDialog({
  open,
  onOpenChange,
  entries,
  startedAt,
  attach,
  onToggleAttach,
}: ConsoleLogPreviewDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("consoleLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <ConsoleLogContent entries={entries} startedAt={startedAt} />

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          {onToggleAttach && (
            <Button onClick={() => { onToggleAttach(!attach); onOpenChange(false); }}>
              {attach ? t("common.detach") : t("common.attach")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
