import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  SquareMousePointer,
  Camera,
  ScanEye,
  Crosshair,
  ImageIcon,
  Loader2,
  SquarePen,
  Timer,
  AppWindow,
  MonitorPlay,
} from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { recordModeMeta } from "@/sidepanel/lib/recordModeMeta";
import { formatMmSs } from "@/sidepanel/lib/logRow";
import { useTabNav } from "@/sidepanel/tab-nav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isCaptureEntryScreen } from "@/lib/capture-commands";
import { PLATFORM_TAB_KEYS } from "@/types/platform";
import { USER_GUIDE_URLS } from "@/lib/external-links";
import { SubmitSuccessView } from "@/sidepanel/components/SubmitSuccessView";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import {
  startPicker,
  stopPickerOrResume,
  startAreaCapture,
  startElementShot,
  cancelAreaCapture,
  clearPicker,
  startFreeformDraft,
} from "@/sidepanel/picker-control";
import { startVideoCapture, startScreenCapture } from "@/sidepanel/video-capture";
import { setAnnotationTool } from "@/sidepanel/annotation-control";
import { ANNOTATION_TOOLS, type AnnotationTool } from "@/sidepanel/components/annotation/presets";
import type { RecordingPenTool } from "@/sidepanel/components/annotation/recording-pen";
import { ColorSwatches, ThicknessButtons, ToolButtons } from "@/sidepanel/components/annotation/ToolbarGroups";
import * as videoRecorder from "@/sidepanel/video-recorder";
import { PageFooter, PageShell } from "@/sidepanel/components/Section";
import { useReplay } from "@/sidepanel/30s-replay/replay-context";
import { DraftingPanel } from "./DraftingPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SelectedPanel } from "./StyleEditorPanel";

export function IssueTab() {
  const phase = useEditorStore((s) => s.phase);
  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const reset = useEditorStore((s) => s.reset);
  const sessionExpired = useEditorStore((s) => s.sessionExpired);
  const tabId = useBoundTabId();
  const { trimming } = useReplay();

  useEffect(() => {
    if (!tabId) return;
    return useEditorStore.subscribe((state, prev) => {
      if (state.phase === "idle" && prev.phase !== "idle" && prev.phase !== "picking") {
        void clearPicker(tabId).catch(() => {});
      }
    });
  }, [tabId]);

  if (!tabId) {
    return <UnsupportedPage />;
  }

  if (phase === "picking") {
    return <PickingState onCancel={() => void stopPickerOrResume(tabId)} />;
  }

  if (phase === "capturing") {
    return (
      <>
        <CapturingState onCancel={() => void cancelAreaCapture(tabId)} />
        <SessionExpiredDialog open={sessionExpired} onConfirm={() => reset()} />
      </>
    );
  }

  if (phase === "recording") {
    return (
      <RecordingState
        onStop={() => videoRecorder.stopRecording()}
        onCancel={() => videoRecorder.cancelRecording()}
      />
    );
  }

  if (phase === "drafting") {
    // 30s replay trim 오버레이가 떠 있는 동안엔 DraftingPanel(LazyTiptapEditor)을 마운트하지 않는다.
    // overlay(ReplayTrimDialog)와 TiptapEditor 두 lazy 청크가 동시에 Suspense 로드되면 editor
    // 라이프사이클 레이스로 storage.markdown이 사라진 stale editor를 건드려 흰 화면이 됐다(replay-trim-refactor 회귀).
    // overlay가 화면을 덮고 있어 trim 중 draft 편집은 불가하므로, 확정/취소 후 마운트해도 UX 동일.
    if (trimming) return null;
    return (
      <>
        <DraftingPanel />
        <SessionExpiredDialog
          open={sessionExpired}
          onConfirm={() => reset()}
        />
      </>
    );
  }

  if (phase === "done") {
    return <SubmitSuccessPanel />;
  }

  if (phase === "previewing") {
    return <PreviewPanel />;
  }

  if (isCaptureEntryScreen({ phase, captureMode, selection })) {
    return (
      <EmptyState
        onStartElement={() => void startPicker(tabId)}
        onStartElementShot={() => void startElementShot(tabId)}
        onStartScreenshot={() => void startAreaCapture(tabId)}
        onStartVideo={() => void startVideoCapture(tabId)}
        onStartScreenRecord={() => void startScreenCapture(tabId)}
        onStartFreeform={() => void startFreeformDraft(tabId)}
      />
    );
  }

  return (
    <>
      <SelectedPanel />
      <SessionExpiredDialog
        open={sessionExpired}
        onConfirm={() => reset()}
      />
    </>
  );
}

function UnsupportedPage() {
  const t = useT();
  return (
    <PageShell>
      <EmptyShell
        icon={<Crosshair className="h-6 w-6 text-muted-foreground" />}
        title={t("issue.unsupported")}
      />
    </PageShell>
  );
}

function EmptyState({ onStartElement, onStartElementShot, onStartScreenshot, onStartVideo, onStartScreenRecord, onStartFreeform }: { onStartElement: () => void; onStartElementShot: () => void; onStartScreenshot: () => void; onStartVideo: () => void; onStartScreenRecord: () => void; onStartFreeform: () => void }) {
  const t = useT();
  const locale = useSettingsUiStore((s) => s.locale);
  const recordingMode = useSettingsUiStore((s) => s.recordingMode);
  const meta = recordModeMeta(recordingMode);
  const RecordIcon = meta.icon === "monitorPlay" ? MonitorPlay : AppWindow;
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-5">
        <div className="flex flex-col items-center gap-1">
          <div className="mb-1 rounded-full bg-muted p-3">
            <SquareMousePointer className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="whitespace-pre-line text-center text-lg font-semibold">{t("issue.empty.title")}</h3>
        </div>
        <TooltipProvider delayDuration={0}>
          <div className="flex w-full max-w-[336px] flex-col gap-2">
            <Button className="w-full" onClick={onStartElement} data-testid="mode-element">
              <Crosshair />
              {t("issue.mode.element")}
            </Button>
            <ButtonGroup className="w-full">
              <Button variant="outline" className="min-w-0 flex-1" onClick={onStartElementShot} data-testid="mode-element-shot">
                <ScanEye />
                <span className="truncate">{t("issue.mode.elementShot")}</span>
              </Button>
              <Button variant="outline" className="min-w-0 flex-1" onClick={onStartScreenshot} data-testid="mode-screenshot">
                <Camera />
                <span className="truncate">{t("issue.mode.screenshot")}</span>
              </Button>
            </ButtonGroup>
            <ButtonGroup className="w-full">
              <Button
                variant="outline"
                className="min-w-0 flex-1"
                onClick={() =>
                  recordingMode === "screen" ? onStartScreenRecord() : onStartVideo()
                }
                data-testid="mode-record"
              >
                <RecordIcon />
                <span className="truncate">{t(meta.labelKey)}</span>
              </Button>
              <ReplayButton className="min-w-0 flex-1" />
            </ButtonGroup>
          </div>
        </TooltipProvider>
      </div>
      <PageFooter>
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => chrome.tabs.create({ url: USER_GUIDE_URLS[locale], active: true })}
          >
            <BookOpen />
            {t("settings.guide")}
          </Button>
          <Button variant="outline" onClick={onStartFreeform} data-testid="mode-freeform">
            <SquarePen />
            {t("issue.startDraft")}
          </Button>
        </div>
      </PageFooter>
    </PageShell>
  );
}

function ReplayButton({ className }: { className?: string }) {
  const t = useT();
  const navTo = useTabNav();
  const { replayEnabled, isReady, isEncoding, bufferedSeconds, capture } = useReplay();
  const tooltip = !replayEnabled
    ? t("issue.replay.tooltip.disabled")
    : !isReady && !isEncoding
      ? t("issue.replay.tooltip.recording")
      : null;

  // 설정 off — 비활성처럼 보이되 클릭은 가능하게 해 설정의 캡처 sub-tab으로 보낸다.
  const button = !replayEnabled ? (
    <Button
      data-testid="replay-button"
      className={cn("w-full opacity-50", className)}
      variant="outline"
      aria-disabled
      onClick={() => navTo("settings", "issue")}
    >
      <Timer />
      {t("issue.mode.replay")}
    </Button>
  ) : (
    <Button
      data-testid="replay-button"
      className={cn(
        "w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        className,
      )}
      variant="outline"
      aria-disabled={!isReady || isEncoding}
      onClick={() => {
        if (!isReady || isEncoding) return;
        void capture();
      }}
    >
      {isEncoding ? <Loader2 className="animate-spin" /> : <Timer />}
      {isEncoding
        ? t("issue.replay.encoding")
        : bufferedSeconds >= 30
          ? t("issue.mode.replay")
          : t("issue.mode.replayProgress", { n: bufferedSeconds })}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function PickingState({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  return (
    <PageShell>
      <EmptyShell
        icon={<Crosshair className="h-6 w-6 text-muted-foreground" />}
        title={t("issue.picking.title")}
        action={
          <Button variant="outline" data-testid="picking-cancel" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        }
      />
    </PageShell>
  );
}

function CapturingState({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  return (
    <PageShell>
      <EmptyShell
        icon={<ImageIcon className="h-6 w-6 text-muted-foreground" />}
        title={t("issue.capturing.title")}
        action={
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        }
      />
    </PageShell>
  );
}

const RECORDING_PEN_TOOLS = ANNOTATION_TOOLS.filter(
  (m) => m.key === "pen" || m.key === "highlight",
);

function RecordingState({ onStop, onCancel }: { onStop: () => void; onCancel: () => void }) {
  const t = useT();
  const source = useEditorStore((s) => s.recordingSource);
  const tool = useEditorStore((s) => s.annotationTool);
  const color = useEditorStore((s) => s.annotationColor);
  const thickness = useEditorStore((s) => s.annotationThickness);
  const tabId = useBoundTabId();
  const [elapsed, setElapsed] = useState(0);
  const maxDuration = videoRecorder.getMaxDuration();

  // 같은 툴을 다시 누르면 off(null). 색/두께 변경은 현재 툴이 켜져 있을 때만 재전송.
  const pickTool = (picked: AnnotationTool) => {
    // ToolButtons에 pen/highlight만 넘기지만 onChange 타입은 AnnotationTool — 가드로 좁힌다.
    if (picked !== "pen" && picked !== "highlight") return;
    const next: RecordingPenTool | null = tool === picked ? null : picked;
    useEditorStore.getState().setAnnotationTool(next);
    if (tabId) void setAnnotationTool(tabId, next, color, thickness);
  };
  const pickColor = (c: string) => {
    useEditorStore.getState().setAnnotationColor(c);
    if (tabId && tool) void setAnnotationTool(tabId, tool, c, thickness);
  };
  const pickThickness = (k: typeof thickness) => {
    useEditorStore.getState().setAnnotationThickness(k);
    if (tabId && tool) void setAnnotationTool(tabId, tool, color, k);
  };

  useEffect(() => {
    setElapsed(videoRecorder.getElapsedSec());
    const id = window.setInterval(() => {
      setElapsed(videoRecorder.getElapsedSec());
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const timeStr = `${formatMmSs(elapsed)} / ${formatMmSs(maxDuration)}`;
  const progress = Math.min(elapsed / maxDuration, 1);

  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
        <div className="mb-3 rounded-full bg-red-100 p-3 dark:bg-red-950">
          {source === "screen" ? (
            <MonitorPlay className="h-6 w-6 text-red-600 dark:text-red-400" />
          ) : (
            <AppWindow className="h-6 w-6 text-red-600 dark:text-red-400" />
          )}
        </div>
        <h3 className="text-lg font-semibold">
          {t(source === "screen" ? "issue.recording.titleScreen" : "issue.recording.titleTab", { time: timeStr })}
        </h3>
        <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button className="w-auto" onClick={onStop}>
            {t("issue.recording.stop")}
          </Button>
        </div>
      </div>
      {/* 화면에 그리기 툴바: [색] [펜·형광펜] [두께] — 이미지 어노테이션과 동일 그룹 재사용.
          취소·제출 같은 액션이 없는 순수 툴바라 action footer(bg-muted)가 아니라 흰 배경(bg-background). */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background p-4"
        title={t("issue.recording.penHint")}
      >
        <ColorSwatches value={color} onChange={pickColor} testIdPrefix="rec-annotation-color" />
        <ToolButtons
          tools={RECORDING_PEN_TOOLS}
          value={tool}
          onChange={pickTool}
          testIdPrefix="rec-annotation-tool"
        />
        <ThicknessButtons
          value={thickness}
          onChange={pickThickness}
          testIdPrefix="rec-annotation-thickness"
        />
      </div>
    </PageShell>
  );
}

function SubmitSuccessPanel() {
  const t = useT();
  const submitResult = useEditorStore((s) => s.submitResult);
  const reset = useEditorStore((s) => s.reset);

  // 제출당 1회만 — t는 매 렌더 새 클로저라 dep만으로는 중복 발화. key 기준 ref 가드 + sonner id로 dedupe.
  const toastedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!submitResult?.logsDropped) return;
    if (toastedKeyRef.current === submitResult.key) return;
    toastedKeyRef.current = submitResult.key;
    toast.warning(
      t("submit.logsDropped", { platform: t(PLATFORM_TAB_KEYS[submitResult.platform]) }),
      { id: `logs-dropped-${submitResult.key}` },
    );
  }, [submitResult, t]);

  if (!submitResult) return null;

  return <SubmitSuccessView result={submitResult} onClose={() => reset()} />;
}

function SessionExpiredDialog({
  open,
  onConfirm,
}: {
  open: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("issue.sessionExpired.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("issue.sessionExpired.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onConfirm}>{t("common.ok")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmptyShell({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">{icon}</div>
      <h3 className="whitespace-pre-line text-lg font-semibold">{title}</h3>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
