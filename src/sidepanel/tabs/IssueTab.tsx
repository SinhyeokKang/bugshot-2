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
  Video,
} from "lucide-react";
import { useT } from "@/i18n";
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
import { useCommandShortcuts } from "@/sidepanel/hooks/useCommandShortcuts";
import {
  startPicker,
  stopPickerOrResume,
  startAreaCapture,
  startElementShot,
  cancelAreaCapture,
  clearPicker,
  startFreeformDraft,
} from "@/sidepanel/picker-control";
import { startVideoCapture } from "@/sidepanel/video-capture";
import * as videoRecorder from "@/sidepanel/video-recorder";
import { PageFooter, PageShell } from "@/sidepanel/components/Section";
import { useReplay } from "@/sidepanel/30s-replay/replay-context";
import { useTabNav } from "@/sidepanel/tab-nav";
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

function ShortcutTooltip({
  shortcut,
  children,
}: {
  shortcut: string | undefined;
  children: React.ReactNode;
}) {
  if (!shortcut) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{shortcut}</TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ onStartElement, onStartElementShot, onStartScreenshot, onStartVideo, onStartFreeform }: { onStartElement: () => void; onStartElementShot: () => void; onStartScreenshot: () => void; onStartVideo: () => void; onStartFreeform: () => void }) {
  const t = useT();
  const shortcuts = useCommandShortcuts();
  const locale = useSettingsUiStore((s) => s.locale);
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
            <ShortcutTooltip shortcut={shortcuts["capture-element"]}>
              <Button className="w-full" onClick={onStartElement} data-testid="mode-element">
                <Crosshair />
                {t("issue.mode.element")}
              </Button>
            </ShortcutTooltip>
            <ButtonGroup className="w-full">
              <Button variant="outline" className="flex-1" onClick={onStartElementShot} data-testid="mode-element-shot">
                <ScanEye />
                {t("issue.mode.elementShot")}
              </Button>
              <ShortcutTooltip shortcut={shortcuts["capture-screenshot"]}>
                <Button variant="outline" className="flex-1" onClick={onStartScreenshot} data-testid="mode-screenshot">
                  <Camera />
                  {t("issue.mode.screenshot")}
                </Button>
              </ShortcutTooltip>
            </ButtonGroup>
            <ButtonGroup className="w-full">
              <ShortcutTooltip shortcut={shortcuts["capture-video"]}>
                <Button variant="outline" className="flex-1" onClick={onStartVideo} data-testid="mode-video">
                  <Video />
                  {t("issue.mode.video")}
                </Button>
              </ShortcutTooltip>
              <ReplayButton />
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

function ReplayButton() {
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
      className="flex-1 rounded-l-none border-l-0 opacity-50"
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
      className="flex-1 rounded-l-none border-l-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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
          <Button variant="outline" onClick={onCancel}>
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

function RecordingState({ onStop, onCancel }: { onStop: () => void; onCancel: () => void }) {
  const t = useT();
  const [elapsed, setElapsed] = useState(0);
  const maxDuration = videoRecorder.getMaxDuration();

  useEffect(() => {
    setElapsed(videoRecorder.getElapsedSec());
    const id = window.setInterval(() => {
      setElapsed(videoRecorder.getElapsedSec());
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const timeStr = `${fmt(elapsed)} / ${fmt(maxDuration)}`;
  const progress = Math.min(elapsed / maxDuration, 1);

  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
        <div className="mb-3 rounded-full bg-red-100 p-3 dark:bg-red-950">
          <Video className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <h3 className="text-lg font-semibold">{t("issue.recording.title", { time: timeStr })}</h3>
        <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button onClick={onStop}>{t("issue.recording.stop")}</Button>
        </div>
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
