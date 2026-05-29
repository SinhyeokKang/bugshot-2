import { ExternalLink, KeyRound } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConnectMethodDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  platformLabel: string;
  oauthLabel: string;
  tokenLabel: string;
  onChooseOAuth: () => void;
  onChooseToken: () => void;
}

export function ConnectMethodDialog({
  open,
  onOpenChange,
  platformLabel,
  oauthLabel,
  tokenLabel,
  onChooseOAuth,
  onChooseToken,
}: ConnectMethodDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("platform.connectMethod.title", { platform: platformLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("platform.connectMethod.body")}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-row justify-end">
          <Button
            variant="outline"
            onClick={() => {
              onChooseToken();
              onOpenChange(false);
            }}
            className="gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {tokenLabel}
          </Button>
          <Button
            onClick={() => {
              onChooseOAuth();
              onOpenChange(false);
            }}
            className="gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {oauthLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
