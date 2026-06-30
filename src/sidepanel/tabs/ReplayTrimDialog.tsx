import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Check, Film, Loader2, MousePointerClick, Pause, Play, Redo2, Terminal, Undo2, X } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ConsoleLogContent } from "@/sidepanel/components/ConsoleLogContent";
import { NetworkLogContent } from "@/sidepanel/components/NetworkLogContent";
import { ActionLogContent } from "@/sidepanel/components/ActionLogContent";
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
import { previewTrimBounds, isTrimmedOut } from "@/sidepanel/30s-replay/trim-math";
import { MAX_FRAME_DURATION_MS } from "@/sidepanel/30s-replay/mp4-encoder";
import type { CapturedFrame } from "@/sidepanel/30s-replay/frame-buffer";
import { TrimTimeline } from "./TrimTimeline";

type TrimTab = "video" | "console" | "network" | "action";

interface ReplayTrimDialogProps {
  videoBlob: Blob;
  frames: CapturedFrame[];
  onConfirm: (startSec: number, endSec: number) => void;
  onCancel: () => void;
  busy?: boolean;
}

function countLabel(n: number): string {
  return n > 999 ? "999+" : String(n);
}

export default function ReplayTrimDialog({ videoBlob, frames, onConfirm, onCancel, busy }: ReplayTrimDialogProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [history, setHistory] = useState<History<[number, number]>>(() => initHistory([0, 0]));
  // 라이브 값(드래그 중 연속 갱신) — 히스토리는 드래그 종료 시 1회만 커밋해 undo 단위를 "한 번의 드래그"로.
  const [value, setValue] = useState<[number, number]>([0, 0]);
  const [activeTab, setActiveTab] = useState<TrimTab>("video");
  // 로그 탭은 첫 활성화 때(=보이는 상태) 마운트하고 이후 유지 — 숨긴 채 마운트하면 NetworkLogContent의
  // 폭 측정(clientWidth*0.3)·tail 자동스크롤이 display:none(scrollHeight 0)에서 무력화된다.
  // 첫 마운트를 visible로 보장 + 재진입 시 필터/검색/스크롤 상태 보존.
  const [mounted, setMounted] = useState<Record<TrimTab, boolean>>({
    video: true,
    console: false,
    network: false,
    action: false,
  });
  const activate = useCallback((tab: TrimTab) => {
    setActiveTab(tab);
    setMounted((m) => (m[tab] ? m : { ...m, [tab]: true }));
  }, []);
  const [cancelOpen, setCancelOpen] = useState(false);
  // 마커 클릭으로 연 탭에서 스크롤·선택할 로그 엔트리 id (수동 탭 전환·스크롤 완료 시 null).
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);

  const consoleLog = useEditorStore((s) => s.consoleLog);
  const networkLog = useEditorStore((s) => s.networkLog);
  const actionLog = useEditorStore((s) => s.actionLog);
  const videoStartedAt = useEditorStore((s) => s.videoStartedAt);

  useEffect(() => {
    const url = URL.createObjectURL(videoBlob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  // 로그 탭 진입 시 자동 일시정지 — 영상이 hidden이고 재생↔로그 동기화가 없어 재생 의미 없음.
  useEffect(() => {
    if (activeTab !== "video") videoRef.current?.pause();
  }, [activeTab]);

  const [startSec, endSec] = value;
  const currentPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const markers = useMemo(
    () => buildErrorMarkers({ consoleLog, networkLog }, videoStartedAt ?? 0, duration),
    [consoleLog, networkLog, videoStartedAt, duration],
  );

  // 트림 후보(잘려나갈 로그) 경계 — apply-trim과 동일 헬퍼 공유로 "흐림 = 실제 잘림" 일치.
  const bounds = useMemo(
    () => previewTrimBounds(frames, startSec, endSec, MAX_FRAME_DURATION_MS),
    [frames, startSec, endSec],
  );
  const isMuted = useCallback(
    (ts: number) => bounds != null && isTrimmedOut(ts, bounds),
    [bounds],
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
      setValue([0, d]);
    }
  }

  // 드래그 중: 라이브 값만 갱신 + 움직인 핸들로 seek (히스토리 미커밋).
  function handleTrimChange(s: number, e: number) {
    seek(s !== value[0] ? s : e);
    setValue([s, e]);
  }

  // 드래그 종료·키 입력 1회: 히스토리에 커밋(undo 한 단위).
  function handleTrimCommit(s: number, e: number) {
    setHistory((h) => pushHistory(h, [s, e]));
  }

  function applyHistory(next: History<[number, number]>) {
    setHistory(next);
    setValue(next.present);
    seek(next.present[0]);
  }

  // 재생은 선택 구간 [start,end]으로 스코프 — 시작 시 좌측 핸들에서, 끝 핸들에서 멈춤.
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < startSec || v.currentTime >= endSec - 0.05) v.currentTime = startSec;
      void v.play();
    } else {
      v.pause();
    }
  }

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    // 재생 중에만 끝 핸들에서 정지. 일시정지 상태의 스크럽은 선택 밖도 허용(Jam).
    if (!v.paused && v.currentTime >= endSec) {
      v.pause();
      v.currentTime = endSec;
    }
    setCurrentTime(v.currentTime);
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
        {/* 1단 정보 bar + 탭 */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span className="font-medium tabular-nums" aria-live="polite">
              {t("issue.replay.trim.selection", { sel, total })}
            </span>
          </div>
          <Tabs
            value={activeTab}
            onValueChange={(v) => { activate(v as TrimTab); setFocusEntryId(null); }}
            className="shrink-0"
          >
            <TabsList className="grid h-9 grid-cols-4">
              <TabsTrigger value="video" disabled={busy} aria-label={t("issue.replay.trim.tab.video")} title={t("issue.replay.trim.tab.video")} data-testid="replay-trim-tab-video">
                <Film className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="console" disabled={!consoleLog || busy} aria-label={t("issue.replay.trim.log.console")} title={t("issue.replay.trim.log.console")} data-testid="replay-trim-tab-console">
                <Terminal className="h-4 w-4" />
                {consoleLog && consoleLog.entries.length > 0 && (
                  <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">{countLabel(consoleLog.entries.length)}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="network" disabled={!networkLog || busy} aria-label={t("issue.replay.trim.log.network")} title={t("issue.replay.trim.log.network")} data-testid="replay-trim-tab-network">
                <ArrowLeftRight className="h-4 w-4" />
                {networkLog && networkLog.requests.length > 0 && (
                  <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">{countLabel(networkLog.requests.length)}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="action" disabled={!actionLog || busy} aria-label={t("issue.replay.trim.log.action")} title={t("issue.replay.trim.log.action")} data-testid="replay-trim-tab-action">
                <MousePointerClick className="h-4 w-4" />
                {actionLog && actionLog.entries.length > 0 && (
                  <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">{countLabel(actionLog.entries.length)}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* 가운데: 영상 + 로그 탭 (전부 마운트, 비활성은 hidden — 상태 보존 + video ref 유지) */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("flex min-h-0 flex-1 items-center justify-center bg-muted/70", activeTab !== "video" && "hidden")}>
            {src && (
              <video
                ref={videoRef}
                src={src}
                className="h-full w-full object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setPaused(false)}
                onPause={() => setPaused(true)}
              />
            )}
          </div>
          {consoleLog && mounted.console && (
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTab !== "console" && "hidden")}>
              <ConsoleLogContent
                flush
                entries={consoleLog.entries}
                startedAt={consoleLog.startedAt}
                syncBaseMs={videoStartedAt ?? undefined}
                isMuted={isMuted}
                scrollToEntryId={activeTab === "console" ? focusEntryId : null}
                onScrollComplete={() => setFocusEntryId(null)}
              />
            </div>
          )}
          {networkLog && mounted.network && (
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTab !== "network" && "hidden")}>
              <NetworkLogContent
                flush
                requests={networkLog.requests}
                syncBaseMs={videoStartedAt ?? undefined}
                isMuted={isMuted}
                scrollToEntryId={activeTab === "network" ? focusEntryId : null}
                onScrollComplete={() => setFocusEntryId(null)}
              />
            </div>
          )}
          {actionLog && mounted.action && (
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTab !== "action" && "hidden")}>
              <ActionLogContent
                flush
                entries={actionLog.entries}
                startedAt={actionLog.startedAt}
                syncBaseMs={videoStartedAt ?? undefined}
                isMuted={isMuted}
                scrollToEntryId={activeTab === "action" ? focusEntryId : null}
                onScrollComplete={() => setFocusEntryId(null)}
              />
            </div>
          )}
        </div>

        {/* 2단 영상 컨트롤러 (전역) */}
        <div className="flex items-center gap-3 border-t px-4 py-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={busy || duration <= 0 || activeTab !== "video"}
            onClick={togglePlay}
            aria-label={paused ? t("issue.replay.trim.play") : t("issue.replay.trim.pause")}
            title={paused ? t("issue.replay.trim.play") : t("issue.replay.trim.pause")}
            data-testid="replay-trim-play"
          >
            {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
          </Button>
          <TrimTimeline
            durationSec={duration}
            currentPct={currentPct}
            startSec={startSec}
            endSec={endSec}
            markers={markers}
            disabled={busy}
            onTrimChange={handleTrimChange}
            onTrimCommit={handleTrimCommit}
            onSeek={seek}
            onMarkerClick={(m) => {
              activate(m.type);
              setFocusEntryId(m.id);
            }}
          />
        </div>

        {/* 3단 액션바 (전역) */}
        <div className="flex items-center justify-between gap-2 border-t px-4 py-4">
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!canUndo(history) || busy}
              onClick={() => applyHistory(undoHistory(history))}
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
              onClick={() => applyHistory(redoHistory(history))}
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
