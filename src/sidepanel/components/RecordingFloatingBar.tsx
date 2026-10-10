import { useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { TooltipIconButton } from "@/sidepanel/components/TooltipIconButton";
import { useRecordingElapsed } from "@/sidepanel/hooks/useRecordingElapsed";
import { formatMmSs } from "@/sidepanel/lib/logRow";
import * as videoRecorder from "@/sidepanel/video-recorder";
import { useEditorStore } from "@/store/editor-store";

// 반전 스코프(.theme-inverse) 안에서는 Tailwind dark variant를 쓰지 않는다 — class 전략은
// 어떤 조상이든 .dark면 매칭돼 반전이 깨진다. Button·TooltipIconButton도 같다(소스 스캔이 잠근다).
export function RecordingFloatingBar() {
  const t = useT();
  const source = useEditorStore((s) => s.recordingSource);
  const { elapsedSec } = useRecordingElapsed();
  const rootRef = useRef<HTMLDivElement>(null);
  const labelKey =
    source === "screen" ? "issue.recording.barLabelScreen" : "issue.recording.barLabelTab";

  // 바가 언마운트되기 전에 포커스를 자기 서브탭 트리거로 옮긴다.
  // Radix TabsContent(role=tabpanel)의 aria-labelledby가 트리거 id다.
  const handleCancel = () => {
    const triggerId = rootRef.current?.closest('[role="tabpanel"]')?.getAttribute("aria-labelledby");
    if (triggerId) document.getElementById(triggerId)?.focus();
    videoRecorder.cancelRecording();
  };

  return (
    <div
      ref={rootRef}
      data-testid="recording-bar"
      role="region"
      aria-label={t(labelKey)}
      className={cn(
        "theme-inverse",
        "absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-xl p-4",
        "bg-background/90 text-foreground shadow-lg backdrop-blur-sm",
      )}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none"
      />
      <span className="min-w-0 truncate text-sm font-medium">{t(labelKey)}</span>
      <span className="shrink-0 text-sm tabular-nums">{formatMmSs(elapsedSec)}</span>
      <div className="ml-auto flex shrink-0 gap-2">
        <TooltipIconButton
          label={t("common.cancel")}
          className="h-9 w-9"
          testId="recording-bar-cancel"
          onClick={handleCancel}
        >
          <X />
        </TooltipIconButton>
        <Button onClick={() => videoRecorder.stopRecording()} data-testid="recording-bar-stop">
          {t("issue.recording.barStop")}
        </Button>
      </div>
    </div>
  );
}
