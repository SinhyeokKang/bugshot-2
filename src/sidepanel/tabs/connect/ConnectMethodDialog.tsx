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
  // 이미 연결된 플랫폼을 다시 연결하는 경우. 재연동은 계정을 교체하므로(setAccount가 전체
  // 대입) 프로젝트·이슈타입 등 기존 설정이 초기화된다 — 무음 손실을 없애려는 한 줄이다.
  reconnect?: boolean;
}

export function ConnectMethodDialog({
  open,
  onOpenChange,
  platformLabel,
  oauthLabel,
  tokenLabel,
  onChooseOAuth,
  onChooseToken,
  reconnect = false,
}: ConnectMethodDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("platform.connectMethod.title", { platform: platformLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("platform.connectMethod.body")}
            {reconnect ? ` ${t("platform.reconnect.note")}` : ""}
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
