import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { RecordingSettingsCard } from "./RecordingSettingsCard";

// 캡처 진입 화면 녹화 버튼 옆 ⚙ — 설정 탭으로 이동하지 않고 녹화 설정만 다이얼로그로 띄운다.
// open/onOpenChange로 controlled — ⚙ 외에 비활성 30초 리플레이 버튼에서도 같은 다이얼로그를 연다.
export function RecordingSettingsDialog({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t("settings.recording")}
          data-testid="mode-record-settings"
        >
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.recording")}</DialogTitle>
        </DialogHeader>
        <RecordingSettingsCard replayInputId="replay-enabled-dialog" />
      </DialogContent>
    </Dialog>
  );
}
