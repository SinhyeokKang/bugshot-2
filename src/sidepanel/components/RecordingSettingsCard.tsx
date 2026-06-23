import { Timer, Video } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { BROAD_HOST_ORIGINS } from "@/lib/broad-host-origins";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import type { RecordingSource } from "@/store/editor-store";

// 설정 탭의 "녹화 설정" 섹션과 캡처 화면 ⚙ 다이얼로그가 공유하는 카드.
// replayInputId는 두 곳이 동시에 마운트될 때 id 충돌을 피하려 분리(설정 탭은 기본 "replay-enabled" 유지 — e2e 의존).
export function RecordingSettingsCard({
  replayInputId = "replay-enabled",
}: {
  replayInputId?: string;
}) {
  const t = useT();
  const recordingMode = useSettingsUiStore((s) => s.recordingMode);
  const setRecordingMode = useSettingsUiStore((s) => s.setRecordingMode);
  const replayEnabled = useSettingsUiStore((s) => s.replayEnabled);
  const setReplayEnabled = useSettingsUiStore((s) => s.setReplayEnabled);

  const handleReplayToggle = async (next: boolean) => {
    if (!next) {
      setReplayEnabled(false);
      return;
    }
    try {
      const has = await chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS });
      const granted =
        has || (await chrome.permissions.request({ origins: BROAD_HOST_ORIGINS }));
      if (granted) setReplayEnabled(true);
      else toast.error(t("settings.replay.permissionDenied"));
    } catch {
      toast.error(t("settings.replay.permissionDenied"));
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <Video className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm">{t("settings.recordingMode.label")}</span>
            <p className="text-sm text-muted-foreground">
              {t("settings.recordingMode.help")}
            </p>
          </div>
          <Tabs
            value={recordingMode}
            onValueChange={(v) => setRecordingMode(v as RecordingSource)}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="tab" data-testid="recording-mode-tab">
                {t("settings.recordingMode.tab")}
              </TabsTrigger>
              <TabsTrigger value="screen" data-testid="recording-mode-screen">
                {t("settings.recordingMode.screen")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Separator />
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <Timer className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <label htmlFor={replayInputId} className="cursor-pointer text-sm">
              {t("settings.replay.label")}
            </label>
            <p className="text-sm text-muted-foreground">
              {t("settings.replay.help")}
            </p>
          </div>
          <Switch
            id={replayInputId}
            checked={replayEnabled}
            onCheckedChange={(v) => void handleReplayToggle(v === true)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
