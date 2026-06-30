import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Redo2, Undo2, X } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEditorStore } from "@/store/editor-store";
import { ConsoleLogPreviewDialog } from "@/sidepanel/components/ConsoleLogPreviewDialog";
import { NetworkLogPreviewDialog } from "@/sidepanel/components/NetworkLogPreviewDialog";
import { ActionLogPreviewDialog } from "@/sidepanel/components/ActionLogPreviewDialog";
import {
  initHistory,
  pushHistory,
  undo as undoHistory,
  redo as redoHistory,
  canUndo,
  canRedo,
  type History,
} from "@/sidepanel/components/annotation/history";
import { buildErrorMarkers } from "@/sidepanel/30s-replay/trim-markers";
import { TrimTimeline } from "./TrimTimeline";

interface ReplayTrimDialogProps {
  videoBlob: Blob;
  onConfirm: (startSec: number, endSec: number) => void;
  onCancel: () => void;
  busy?: boolean;
}

export default function ReplayTrimDialog({ videoBlob, onConfirm, onCancel, busy }: ReplayTrimDialogProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [history, setHistory] = useState<History<[number, number]>>(() => initHistory([0, 0]));
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const consoleLog = useEditorStore((s) => s.consoleLog);
  const networkLog = useEditorStore((s) => s.networkLog);
  const actionLog = useEditorStore((s) => s.actionLog);
  const consoleLogAttach = useEditorStore((s) => s.consoleLogAttach);
  const networkLogAttach = useEditorStore((s) => s.networkLogAttach);
  const actionLogAttach = useEditorStore((s) => s.actionLogAttach);
  const setConsoleLogAttach = useEditorStore((s) => s.setConsoleLogAttach);
  const setNetworkLogAttach = useEditorStore((s) => s.setNetworkLogAttach);
  const setActionLogAttach = useEditorStore((s) => s.setActionLogAttach);
  const videoStartedAt = useEditorStore((s) => s.videoStartedAt);

  useEffect(() => {
    const url = URL.createObjectURL(videoBlob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  const [startSec, endSec] = history.present;
  const currentPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const markers = useMemo(
    () => buildErrorMarkers({ consoleLog, networkLog }, videoStartedAt ?? 0, duration),
    [consoleLog, networkLog, videoStartedAt, duration],
  );

  function seek(sec: number) {
    const v = videoRef.current;
    if (v) v.currentTime = sec;
  }

  function handleLoadedMetadata() {
    const d = videoRef.current?.duration;
    if (d != null && Number.isFinite(d) && d > 0) {
      setDuration(d);
      setHistory(initHistory([0, d]));
    }
  }

  function handleTrimChange(s: number, e: number) {
    seek(s !== startSec ? s : e);
    setHistory((h) => pushHistory(h, [s, e]));
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  const sel = Math.max(0, Math.round(endSec - startSec));
  const total = Math.round(duration);

  return (
    <div
      className="absolute inset-0 z-50 bg-background"
      data-testid="replay-trim-overlay"
      data-trim-selection={sel}
    >
      <div className="flex h-full flex-col">
        {/* 1단 정보 bar */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span className="font-medium tabular-nums" aria-live="polite">
              {t("issue.replay.trim.selection", { sel, total })}
            </span>
            <span className="truncate text-muted-foreground">{t("issue.replay.trim.hint")}</span>
          </div>
          <ButtonGroup className="shrink-0">
            <Button variant="outline" size="sm" disabled={!consoleLog || busy} onClick={() => setConsoleOpen(true)} data-testid="replay-trim-log-console">
              {t("issue.replay.trim.log.console")}
            </Button>
            <Button variant="outline" size="sm" disabled={!networkLog || busy} onClick={() => setNetworkOpen(true)} data-testid="replay-trim-log-network">
              {t("issue.replay.trim.log.network")}
            </Button>
            <Button variant="outline" size="sm" disabled={!actionLog || busy} onClick={() => setActionOpen(true)} data-testid="replay-trim-log-action">
              {t("issue.replay.trim.log.action")}
            </Button>
          </ButtonGroup>
        </div>

        {/* canvas */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/70">
          {src && (
            <video
              ref={videoRef}
              src={src}
              className="aspect-video max-h-full w-full object-contain"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
            />
          )}
        </div>

        {/* 2단 영상 컨트롤러 */}
        <div className="flex items-center gap-3 border-t px-4 py-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={busy || duration <= 0}
            onClick={togglePlay}
            aria-label={paused ? t("issue.replay.trim.play") : t("issue.replay.trim.pause")}
            title={paused ? t("issue.replay.trim.play") : t("issue.replay.trim.pause")}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <TrimTimeline
            durationSec={duration}
            currentPct={currentPct}
            startSec={startSec}
            endSec={endSec}
            markers={markers}
            disabled={busy}
            onTrimChange={handleTrimChange}
          />
        </div>

        {/* 3단 액션바 */}
        <div className="flex items-center justify-between gap-2 border-t px-4 py-4">
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!canUndo(history) || busy}
              onClick={() => setHistory((h) => undoHistory(h))}
              aria-label={t("issue.replay.trim.undo")}
              title={t("issue.replay.trim.undo")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!canRedo(history) || busy}
              onClick={() => setHistory((h) => redoHistory(h))}
              aria-label={t("issue.replay.trim.redo")}
              title={t("issue.replay.trim.redo")}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={busy}
              onClick={() => setCancelOpen(true)}
              aria-label={t("issue.replay.trim.cancel")}
              title={t("issue.replay.trim.cancel")}
              data-testid="replay-trim-cancel"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-8 w-8"
              disabled={busy || duration <= 0}
              onClick={() => onConfirm(startSec, endSec)}
              aria-label={t("issue.replay.trim.confirm")}
              title={t("issue.replay.trim.confirm")}
              data-testid="replay-trim-confirm"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
          </ButtonGroup>
        </div>
      </div>

      {consoleLog && (
        <ConsoleLogPreviewDialog
          open={consoleOpen}
          onOpenChange={setConsoleOpen}
          entries={consoleLog.entries}
          startedAt={consoleLog.startedAt}
          attach={consoleLogAttach}
          onToggleAttach={setConsoleLogAttach}
        />
      )}
      {networkLog && (
        <NetworkLogPreviewDialog
          open={networkOpen}
          onOpenChange={setNetworkOpen}
          requests={networkLog.requests}
          attach={networkLogAttach}
          onToggleAttach={setNetworkLogAttach}
        />
      )}
      {actionLog && (
        <ActionLogPreviewDialog
          open={actionOpen}
          onOpenChange={setActionOpen}
          entries={actionLog.entries}
          startedAt={actionLog.startedAt}
          attach={actionLogAttach}
          onToggleAttach={setActionLogAttach}
        />
      )}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="z-[60]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelConfirm.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
            <AlertDialogAction onClick={onCancel} data-testid="replay-trim-cancel-confirm">
              {t("cancelConfirm.trigger")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
