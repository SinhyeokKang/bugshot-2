import { useT } from "@/i18n";
import type { NetworkRequest } from "@/types/network";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NetworkLogContent } from "./NetworkLogContent";

interface NetworkLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: NetworkRequest[];
  attach?: boolean;
  onToggleAttach?: (attach: boolean) => void;
}

export function NetworkLogPreviewDialog({
  open,
  onOpenChange,
  requests,
  attach,
  onToggleAttach,
}: NetworkLogPreviewDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("networkLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <NetworkLogContent requests={requests} />

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
