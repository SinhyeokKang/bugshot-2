import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  SquareMousePointer,
  Camera,
  Crop,
  Monitor,
  ScanEye,
  ScanText,
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
import { connectedPlatforms, useSettingsStore } from "@/store/settings-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { IntegrationsCta } from "@/sidepanel/components/IntegrationsCta";
import { TooltipIconButton } from "@/sidepanel/components/TooltipIconButton";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import {
  startPicker,
  stopPickerOrResume,
  startAreaCapture,
  startElementShot,
  cancelAreaCapture,
  captureFullViewport,
  clearPicker,
  maybeSurfacePermissionExpired,
  startFreeformDraft,
} from "@/sidepanel/picker-control";
import { runScrollCapture } from "@/sidepanel/scroll-capture";
import { startVideoCapture, startScreenCapture } from "@/sidepanel/video-capture";
import { setAnnotationTool } from "@/sidepanel/annotation-control";
import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOLS,
  recordingColorCount,
  type AnnotationTool,
} from "@/sidepanel/components/annotation/presets";
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
  const t = useT();
  const [scrollProgress, setScrollProgress] = useState<{ done: number; total: number } | null>(null);
  const [viewportBusy, setViewportBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const scrollAbortRef = useRef<AbortController | null>(null);
  // 캡처가 인플라이트인 동안은 다른 캡처 버튼을 막는다 — 연타하면 진행 중 캡처가 reset으로 날아간다.
  const captureBusy = scrollProgress !== null || viewportBusy;

  useEffect(() => {
    if (!tabId) return;
    return useEditorStore.subscribe((state, prev) => {
      if (state.phase === "idle" && prev.phase !== "idle" && prev.phase !== "picking") {
        void clearPicker(tabId).catch(() => {});
      }
    });
  }, [tabId]);

  // 언마운트(탭 전환·패널 재마운트) 시 진행 중 루프를 끊는다 — 안 끊으면 캡처 큐를 계속 점유한다.
  useEffect(() => () => scrollAbortRef.current?.abort(), []);

  // capturing을 벗어나면(캡처 완료·세션 만료·URL 변경) 진행 중 루프를 끊고 잠금을 푼다 —
  // 안 그러면 다음 capturing 진입이 "캡처 중" + 버튼 잠김 상태로 열린다.
  useEffect(() => {
    if (phase === "capturing") return;
    scrollAbortRef.current?.abort();
    setViewportBusy(false);
    setCanceling(false);
  }, [phase]);

  const startFullPageCapture = (id: number) => {
    if (captureBusy) return;
    const controller = new AbortController();
    scrollAbortRef.current = controller;
    setScrollProgress({ done: 0, total: 1 });
    // 늦게 끝난 이전 run이 새 run의 상태·결과를 덮지 않도록 controller를 소유권 토큰으로 쓴다.
    const isCurrent = () =>
      scrollAbortRef.current === controller &&
      !controller.signal.aborted &&
      useEditorStore.getState().phase === "capturing" &&
      useEditorStore.getState().target?.tabId === id;

    void runScrollCapture(id, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (scrollAbortRef.current === controller) setScrollProgress({ done, total });
      },
    })
      .then((result) => {
        // 캡처 중 취소·세션 만료·URL 변경·picker 단절이 있었으면 결과를 버린다(유령 drafting 방지).
        if (!isCurrent()) return;
        useEditorStore.getState().onAreaCaptured(result.dataUrl, result.viewport);
        if (result.truncated) toast.info(t("issue.capturing.truncated"));
      })
      .catch((err) => {
        if (!controller.signal.aborted && !maybeSurfacePermissionExpired(err)) {
          console.error("[bugshot] scroll capture failed", err);
        }
        const owned =
          scrollAbortRef.current === controller &&
          useEditorStore.getState().phase === "capturing" &&
          useEditorStore.getState().target?.tabId === id;
        if (owned) useEditorStore.getState().reset();
      })
      .finally(() => {
        if (scrollAbortRef.current !== controller) return;
        scrollAbortRef.current = null;
        setScrollProgress(null);
        setCanceling(false);
      });
  };

  const captureViewport = (id: number) => {
    if (captureBusy) return;
    // content 응답(수 ms)이 아니라 실제 캡처(captureVisibleTab 큐, 수백 ms)가 끝날 때까지 잠근다.
    // 해제는 phase가 capturing을 벗어나는 시점(위 effect) — 연타로 진행 중 캡처를 날리지 않게.
    setViewportBusy(true);
    void captureFullViewport(id).then((ok) => {
      // content가 area-select 상태가 아니면(주입 소실·레이스) 조용히 갇히지 않게 idle로 되돌린다.
      if (!ok && useEditorStore.getState().phase === "capturing") {
        useEditorStore.getState().reset();
      }
    });
  };

  const cancelCapturing = (id: number) => {
    const controller = scrollAbortRef.current;
    if (controller) {
      // abort는 다음 타일 경계에서만 반영된다(캡처 큐 왕복 ≤1초) — 그 사이 "취소 중"을 보여준다.
      setCanceling(true);
      controller.abort();
      return;
    }
    void cancelAreaCapture(id);
  };

  if (!tabId) {
    return <UnsupportedPage />;
  }

  if (phase === "picking") {
    return <PickingState onCancel={() => void stopPickerOrResume(tabId)} />;
  }

  if (phase === "capturing") {
    return (
      <>
        <CapturingState
          onCancel={() => cancelCapturing(tabId)}
          onViewport={() => captureViewport(tabId)}
          onFullPage={() => startFullPageCapture(tabId)}
          progress={scrollProgress}
          busy={captureBusy}
          canceling={canceling}
        />
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
  const navTo = useTabNav();
  const accounts = useSettingsStore((s) => s.accounts);
  const noPlatformConnected = connectedPlatforms(accounts).length === 0;
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
      {noPlatformConnected && (
        <IntegrationsCta onNavigate={() => navTo("integrations")} />
      )}
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

function CapturingState({
  onCancel,
  onViewport,
  onFullPage,
  progress,
  busy,
  canceling,
}: {
  onCancel: () => void;
  onViewport: () => void;
  onFullPage: () => void;
  progress: { done: number; total: number } | null;
  busy: boolean;
  canceling: boolean;
}) {
  const t = useT();
  const percent = progress
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0;
  // disabled는 pointer-events를 죽여 title 툴팁·스피너 대비까지 잃는다 — ReplayButton과 같은
  // aria-disabled 관용구로 시각·툴팁을 유지하고 핸들러에서 가드한다.
  const lockedClass = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
  return (
    <PageShell>
      <EmptyShell
        icon={<ImageIcon className="h-6 w-6 text-muted-foreground" />}
        title={
          canceling
            ? t("issue.capturing.canceling")
            : busy
              ? t("issue.capturing.scrolling")
              : t("issue.capturing.title")
        }
        action={
          <Button
            variant="outline"
            data-testid="capturing-cancel"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={canceling}
            onClick={() => {
              if (canceling) return;
              onCancel();
            }}
          >
            {t("common.cancel")}
          </Button>
        }
      >
        {progress ? (
          <>
            <p className="mt-2 text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {t("issue.capturing.progress", { percent })}
            </p>
            <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        ) : null}
      </EmptyShell>
      {/* 캡처 방식 툴바 — 녹화 중 그리기 툴바와 같은 자리(하단 footer). 영역 선택은 지금 켜져
          있는 모드(활성 표시), 뷰포트·스크롤은 누르면 즉시 캡처되는 액션이라 pressed가 아니다. */}
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border bg-background p-4">
        <ButtonGroup className="flex-nowrap">
          <TooltipIconButton
            label={t("issue.capturing.method.area")}
            active={!busy}
            ariaDisabled={busy}
            className={lockedClass}
            testId="capture-method-area"
          >
            <Crop />
          </TooltipIconButton>
          <TooltipIconButton
            label={t("issue.capturing.method.viewport")}
            ariaDisabled={busy}
            className={lockedClass}
            testId="capture-method-viewport"
            onClick={onViewport}
          >
            <Monitor />
          </TooltipIconButton>
          <TooltipIconButton
            label={t("issue.capturing.method.fullPage")}
            ariaDisabled={busy}
            // 진행 중엔 이 버튼이 스피너를 들고 있으므로 흐리게 만들지 않는다.
            className="aria-disabled:cursor-not-allowed"
            testId="capture-method-fullpage"
            onClick={onFullPage}
          >
            {busy ? <Loader2 className="animate-spin" /> : <ScanText />}
          </TooltipIconButton>
        </ButtonGroup>
      </div>
    </PageShell>
  );
}

// 녹화 오버레이는 자유곡선·사각형·형광펜 3종. ANNOTATION_TOOLS 순서(pen → rect → highlight)를 따른다.
const RECORDING_PEN_TOOLS = ANNOTATION_TOOLS.filter(
  (m) => m.key === "pen" || m.key === "rect" || m.key === "highlight",
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

  // 툴바 폭이 좁으면 우측 색부터 접는다(최소 3색). footer 실제 폭을 관측.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [colorCount, setColorCount] = useState<number>(ANNOTATION_COLORS.length);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () => setColorCount(recordingColorCount(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 같은 툴을 다시 누르면 off(null). 색/두께 변경은 현재 툴이 켜져 있을 때만 재전송.
  const pickTool = (picked: AnnotationTool) => {
    // ToolButtons엔 RECORDING_PEN_TOOLS만 넘기지만 onChange 타입은 AnnotationTool — 가드로 좁힌다.
    if (picked !== "pen" && picked !== "rect" && picked !== "highlight") return;
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
      {/* 화면에 그리기 툴바: [펜·사각형·형광펜] [색] [두께] — 이미지 어노테이션과 동일 그룹 재사용.
          취소·제출 같은 액션이 없는 순수 툴바라 action footer(bg-muted)가 아니라 흰 배경(bg-background). */}
      <div
        ref={toolbarRef}
        className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background p-4"
        title={t("issue.recording.penHint")}
      >
        <ToolButtons
          tools={RECORDING_PEN_TOOLS}
          value={tool}
          onChange={pickTool}
          testIdPrefix="rec-annotation-tool"
        />
        <ColorSwatches
          value={color}
          onChange={pickColor}
          count={colorCount}
          testIdPrefix="rec-annotation-color"
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
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">{icon}</div>
      <h3 className="whitespace-pre-line text-lg font-semibold">{title}</h3>
      {children}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
