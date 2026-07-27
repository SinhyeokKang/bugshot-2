import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Check, Film, Loader2, MousePointerClick, Pause, Play, Redo2, Terminal, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
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
import { previewBoundsFor, isTrimmedOut } from "@/sidepanel/30s-replay/trim-math";
import { MAX_FRAME_DURATION_MS } from "@/sidepanel/30s-replay/mp4-encoder";
import type { TrimSource } from "@/sidepanel/30s-replay/trim-source";
import { TrimTimeline } from "./TrimTimeline";

type TrimTab = "video" | "console" | "network" | "action";

export interface TrimConfirm {
  startSec: number;
  endSec: number;
  durationSec: number;
  // 벽시계 초 → 미디어 초 환산 계수. 재인코딩은 <video>.currentTime을 다루므로 필요하다.
  mediaScale: number;
}

interface ReplayTrimDialogProps {
  videoBlob: Blob;
  source: TrimSource;
  onConfirm: (range: TrimConfirm) => void;
  onCancel: () => void;
  busy?: boolean;
  progress?: number;
}

function countLabel(n: number): string {
  return n > 999 ? "999+" : String(n);
}

// 녹화 소스는 벽시계 길이를 마운트 시점에 이미 알고 있다. duration을 loadedmetadata에서만 세우면
// 손상 blob·디코더 실패로 그 이벤트가 안 올 때 확정 버튼이 영구 disabled가 돼 출구가 "취소=녹화
// 폐기"뿐이 된다. 축 자체도 벽시계여야 한다 — MediaRecorder는 damage 기반 가변 fps라 정지 화면이
// 길면 <video>.duration이 경과보다 크게 짧고, 그걸 축으로 삼으면 로그가 통째로 잘못 잘린다.
function sourceDurationSec(source: TrimSource): number {
  return source.kind === "recording" ? (source.endedAt - source.startedAt) / 1000 : 0;
}

export default function ReplayTrimDialog({ videoBlob, source, onConfirm, onCancel, busy, progress }: ReplayTrimDialogProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(() => sourceDurationSec(source));
  // 미디어 타임 ↔ 벽시계 환산. 미디어 길이를 못 읽으면 1(= 그대로) — seek만 어긋나고 경계는 무사.
  const [mediaScale, setMediaScale] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [history, setHistory] = useState<History<[number, number]>>(() =>
    initHistory([0, sourceDurationSec(source)]),
  );
  // 라이브 값(드래그 중 연속 갱신) — 히스토리는 드래그 종료 시 1회만 커밋해 undo 단위를 "한 번의 드래그"로.
  const [value, setValue] = useState<[number, number]>(() => [0, sourceDurationSec(source)]);
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

  // 진입 안내 토스트(영상 트림 사용법) — 오버레이당 1회. (클릭 닫기·커서는 Toaster 래퍼에서 전역 처리.)
  useEffect(() => {
    toast.info(t("issue.replay.trim.toast"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(videoBlob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  // 로그 탭 진입 시 자동 일시정지 — 영상이 hidden이고 재생↔로그 동기화가 없어 재생 의미 없음.
  useEffect(() => {
    if (activeTab !== "video") videoRef.current?.pause();
  }, [activeTab]);

  // 재인코딩은 <video> 재생 기반이라 패널이 hidden이면 진행이 멈춘다. 액션바 중앙 슬롯은
  // percent만 들어갈 폭이라(≈144px) 이 안내는 토스트로 낸다. 재인코딩이 있는 소스만.
  const encoding = busy === true && progress !== undefined;
  useEffect(() => {
    if (encoding) toast.info(t("issue.replay.trim.keepTab"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoding]);

  const [startSec, endSec] = value;
  const currentPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const markers = useMemo(
    () => buildErrorMarkers({ consoleLog, networkLog, actionLog }, videoStartedAt ?? 0, duration),
    [consoleLog, networkLog, actionLog, videoStartedAt, duration],
  );

  // 트림 후보(잘려나갈 로그) 경계 — apply-trim과 동일 헬퍼 공유로 "흐림 = 실제 잘림" 일치.
  const bounds = useMemo(
    () =>
      previewBoundsFor(
        source,
        { startSec, endSec },
        { durationSec: duration, maxFrameDurationMs: MAX_FRAME_DURATION_MS },
      ),
    [source, startSec, endSec, duration],
  );
  const isMuted = useCallback(
    (ts: number) => bounds != null && isTrimmedOut(ts, bounds),
    [bounds],
  );

  // 타임라인은 벽시계 축이고 <video>는 미디어 축이라, 경계에서만 환산한다.
  function seek(wallSec: number) {
    const v = videoRef.current;
    if (v) v.currentTime = wallSec * mediaScale;
  }

  function wallNow(v: HTMLVideoElement): number {
    return mediaScale > 0 ? v.currentTime / mediaScale : v.currentTime;
  }

  function handleLoadedMetadata() {
    const d = videoRef.current?.duration;
    const usable = d != null && Number.isFinite(d) && d > 0;
    if (source.kind === "recording") {
      // 벽시계 축은 이미 마운트 시점에 확정 — 여기선 재생 헤드 환산 계수만 잡는다.
      const wall = sourceDurationSec(source);
      setMediaScale(usable && wall > 0 ? d / wall : 1);
      return;
    }
    if (usable) {
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
  // 로그 탭에서 누르면 영상 탭으로 전환해 재생(영상이 hidden이면 보이지 않으므로).
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (activeTab !== "video") activate("video");
    if (v.paused) {
      const now = wallNow(v);
      if (now < startSec || now >= endSec - 0.05) seek(startSec);
      void v.play();
    } else {
      v.pause();
    }
  }

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    const now = wallNow(v);
    // 재생 중에만 끝 핸들에서 정지. 일시정지 상태의 스크럽은 선택 밖도 허용(Jam).
    if (!v.paused && now >= endSec) {
      v.pause();
      seek(endSec);
    }
    setCurrentTime(now);
  }

  const sel = Math.max(0, Math.round(endSec - startSec));
  const total = Math.round(duration);
  const percent = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);

  return (
    <div
      className="fixed inset-0 z-50 bg-background"
      // aria-modal은 붙이지 않는다 — 뒤 트리를 inert로 만들지도, 포커스를 가두지도 않으므로
      // "바깥은 비활성"이라는 거짓 약속이 된다. role+label만으로 화면 전환을 알린다.
      role="dialog"
      aria-label={t("issue.replay.trim.title")}
      data-testid="replay-trim-overlay"
      data-trim-selection={sel}
    >
      <div className="flex h-full flex-col">
        {/* 1단: 아이콘+레이블 탭(full-width). 로그 탭은 0건이어도 활성(empty case 조회) + 카운트 Badge 상시. */}
        <div className="border-b px-4 py-3">
          <Tabs
            value={activeTab}
            onValueChange={(v) => { activate(v as TrimTab); setFocusEntryId(null); }}
          >
            <CollapsingTabsList className="grid h-9 w-full grid-cols-4">
              <TabsTrigger value="video" disabled={busy} className="min-w-0 gap-1.5" data-testid="replay-trim-tab-video">
                <Film className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("issue.replay.trim.tab.video")}</TabLabel>
              </TabsTrigger>
              <TabsTrigger value="console" disabled={busy} className="min-w-0 gap-1.5" data-testid="replay-trim-tab-console">
                <Terminal className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("issue.replay.trim.log.console")}</TabLabel>
                <Badge className="h-4 min-w-4 shrink-0 px-1 text-[10px]">{countLabel(consoleLog?.entries.length ?? 0)}</Badge>
              </TabsTrigger>
              <TabsTrigger value="network" disabled={busy} className="min-w-0 gap-1.5" data-testid="replay-trim-tab-network">
                <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("issue.replay.trim.log.network")}</TabLabel>
                <Badge className="h-4 min-w-4 shrink-0 px-1 text-[10px]">{countLabel(networkLog?.requests.length ?? 0)}</Badge>
              </TabsTrigger>
              <TabsTrigger value="action" disabled={busy} className="min-w-0 gap-1.5" data-testid="replay-trim-tab-action">
                <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("issue.replay.trim.log.action")}</TabLabel>
                <Badge className="h-4 min-w-4 shrink-0 px-1 text-[10px]">{countLabel(actionLog?.entries.length ?? 0)}</Badge>
              </TabsTrigger>
            </CollapsingTabsList>
          </Tabs>
        </div>

        {/* 가운데: 영상 + 로그 탭 (전부 마운트, 비활성은 hidden — 상태 보존 + video ref 유지) */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("flex min-h-0 flex-1 items-center justify-center bg-muted", activeTab !== "video" && "hidden")}>
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
          {mounted.console && (
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTab !== "console" && "hidden")}>
              <ConsoleLogContent
                flush
                entries={consoleLog?.entries ?? []}
                startedAt={consoleLog?.startedAt}
                syncBaseMs={videoStartedAt ?? undefined}
                isMuted={isMuted}
                scrollToEntryId={activeTab === "console" ? focusEntryId : null}
                onScrollComplete={() => setFocusEntryId(null)}
              />
            </div>
          )}
          {mounted.network && (
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTab !== "network" && "hidden")}>
              <NetworkLogContent
                flush
                requests={networkLog?.requests ?? []}
                syncBaseMs={videoStartedAt ?? undefined}
                isMuted={isMuted}
                scrollToEntryId={activeTab === "network" ? focusEntryId : null}
                onScrollComplete={() => setFocusEntryId(null)}
              />
            </div>
          )}
          {mounted.action && (
            <div className={cn("flex min-h-0 flex-1 flex-col", activeTab !== "action" && "hidden")}>
              <ActionLogContent
                flush
                entries={actionLog?.entries ?? []}
                startedAt={actionLog?.startedAt}
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
            disabled={busy || duration <= 0}
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
          <ButtonGroup className="shrink-0">
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
          {/* 선택 길이 readout — 1단에서 옮겨와 액션바 중앙에. 확정 중엔 진행률로 교체
              (최대 15초 걸리는데 스피너만 두면 멈춘 것처럼 보인다). 바 마크업은 IssueTab의
              스크롤 캡처 진행률(CapturingState)과 같은 토큰·전환, 폭만 좁은 슬롯에 맞췄다.
              문구는 percent만 — 여기 가용폭이 ~144px라 안내 문장은 잘린다(진입 시 토스트로 안내). */}
          {busy && progress !== undefined ? (
            <div className="flex min-w-0 flex-col items-center gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("issue.replay.trim.progress", { percent })}
              </span>
              <div
                className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("issue.replay.trim.progressLabel")}
              >
                <div
                  className="h-full rounded-full bg-foreground transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="font-medium tabular-nums text-sm" aria-live="polite">
              {t("issue.replay.trim.selection", { sel, total })}
            </span>
          )}
          <ButtonGroup className="shrink-0">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              // 확정 버튼과 같은 관용구 — busy는 최대 15초라 pointer-events까지 죽이면
              // hover·title이 사라져 "왜 안 눌리나"에 대한 답이 화면에서 없어진다(DESIGN §10).
              aria-disabled={busy}
              onClick={() => { if (busy) return; setCancelOpen(true); }}
              aria-label={t("issue.replay.trim.cancel")}
              title={t("issue.replay.trim.cancel")}
              data-testid="replay-trim-cancel"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-8 w-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              // 스피너를 든 busy는 aria-disabled(포커스 보존) + 핸들러 가드, 진짜 불가 상태
              // (duration<=0)만 순수 disabled — 8개 연동 폼과 같은 관용구(DESIGN §10).
              disabled={duration <= 0 && !busy}
              aria-disabled={busy}
              onClick={() => {
                if (busy || duration <= 0) return;
                // 미리보기 재생을 멈춰야 재인코딩용 디코더와 같은 blob을 두고 경쟁하지 않는다.
                videoRef.current?.pause();
                onConfirm({ startSec, endSec, durationSec: duration, mediaScale });
              }}
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
            {/* editor.cancelConfirm.*를 공유하지 않는다 — 이 시점엔 작성한 내용이 없고
                실제로 잃는 건 방금 찍은 영상·로그다. */}
            <AlertDialogTitle>{t("issue.replay.trim.cancelConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("issue.replay.trim.cancelConfirm.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
            <AlertDialogAction onClick={onCancel} data-testid="replay-trim-cancel-confirm">
              {t("issue.replay.trim.cancelConfirm.trigger")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
