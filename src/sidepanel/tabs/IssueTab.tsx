import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bug,
  Camera,
  CircleCheck,
  Crosshair,
  ImageIcon,
  List,
  Video,
} from "lucide-react";
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
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { captureElementSnapshot } from "../capture";
import { startPicker, stopPicker, startAreaCapture, cancelAreaCapture } from "../picker-control";
import * as videoRecorder from "../video-recorder";
import { PageShell } from "../components/Section";
import { useTabNav } from "../App";
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
    const safeCaptureBeforeImage = (tid: number) => {
      void captureElementSnapshot(tid)
        .then((img) => {
          if (img) useEditorStore.getState().setBeforeImage(img);
        })
        .catch((err) => console.warn("[bugshot] before-image capture failed", err));
    };
    if (useEditorStore.getState().phase === "idle") {
      safeCaptureBeforeImage(tabId);
    }
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.phase === "styling" && prev.phase === "picking") {
        safeCaptureBeforeImage(tabId);
      }
    });
    return unsub;
  }, [tabId]);

  if (!tabId) {
    return <UnsupportedPage />;
  }

  if (phase === "picking") {
    return <PickingState onCancel={() => void stopPicker(tabId)} />;
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
    return <SubmitSuccessView />;
  }

  if (phase === "previewing") {
    return <PreviewPanel />;
  }

  if (phase === "idle" || (captureMode === "element" && !selection)) {
    return (
      <EmptyState
        onStartElement={() => void startPicker(tabId)}
        onStartScreenshot={() => void startAreaCapture(tabId)}
        onStartVideo={() => void handleStartVideo(tabId)}
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
  return (
    <PageShell>
      <EmptyShell
        icon={<Crosshair className="h-6 w-6 text-muted-foreground" />}
        title="지원하지 않는 페이지"
      />
    </PageShell>
  );
}

async function handleStartVideo(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  useEditorStore.getState().startRecording({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await videoRecorder.startRecording(tabId);
  } catch (err) {
    console.warn("[bugshot] video recording failed to start", err);
    useEditorStore.getState().cancelRecording();
  }
}

function EmptyState({ onStartElement, onStartScreenshot, onStartVideo }: { onStartElement: () => void; onStartScreenshot: () => void; onStartVideo: () => void }) {
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        <div className="flex flex-col items-center gap-1">
          <div className="mb-1 rounded-full bg-muted p-3">
            <Bug className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-[18px] font-semibold">이슈 작성 방식 선택</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button className="col-span-2" onClick={onStartElement}>
            <Crosshair />
            DOM 요소 선택
          </Button>
          <Button variant="outline" onClick={onStartScreenshot}>
            <Camera />
            화면 캡처
          </Button>
          <Button variant="outline" onClick={onStartVideo}>
            <Video />
            영상 녹화
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

function PickingState({ onCancel }: { onCancel: () => void }) {
  return (
    <PageShell>
      <EmptyShell
        icon={<Crosshair className="h-6 w-6 text-muted-foreground" />}
        title="요소를 선택하세요"
        action={
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
        }
      />
    </PageShell>
  );
}

function CapturingState({ onCancel }: { onCancel: () => void }) {
  return (
    <PageShell>
      <EmptyShell
        icon={<ImageIcon className="h-6 w-6 text-muted-foreground" />}
        title="캡처 영역을 선택하세요"
        action={
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
        }
      />
    </PageShell>
  );
}

function RecordingState({ onStop, onCancel }: { onStop: () => void; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const maxDuration = videoRecorder.getMaxDuration();

  useEffect(() => {
    setElapsed(videoRecorder.getElapsedSec());
    const id = window.setInterval(() => {
      setElapsed(videoRecorder.getElapsedSec());
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const progress = Math.min(elapsed / maxDuration, 1);

  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-red-100 p-3">
          <Video className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="text-[18px] font-semibold">녹화 중 {timeStr}</h3>
        <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">최대 {maxDuration}초</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onCancel}>취소</Button>
          <Button onClick={onStop}>녹화 완료</Button>
        </div>
      </div>
    </PageShell>
  );
}

function SubmitSuccessView() {
  const submitResult = useEditorStore((s) => s.submitResult);
  const reset = useEditorStore((s) => s.reset);
  const setTab = useTabNav();

  if (!submitResult) return null;

  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <CircleCheck className="h-6 w-6 text-green-600" />
        </div>
        <h3 className="text-[18px] font-semibold">이슈가 제출되었습니다</h3>
        <a
          href={submitResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {submitResult.key}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setTab("issue-list");
            }}
          >
            <List className="h-4 w-4" />
            이슈 목록
          </Button>
          <Button onClick={() => reset()}>
            확인
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

function SessionExpiredDialog({
  open,
  onConfirm,
}: {
  open: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>페이지가 갱신되었습니다</AlertDialogTitle>
          <AlertDialogDescription>
            작성 중인 내용이 초기화됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onConfirm}>확인</AlertDialogAction>
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
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">{icon}</div>
      <h3 className="text-[18px] font-semibold">{title}</h3>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
