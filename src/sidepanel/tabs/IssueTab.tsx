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
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { startPicker, stopPicker, startAreaCapture, cancelAreaCapture, clearPicker, injectNetworkRecorder } from "../picker-control";
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

async function handleStartVideo(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  useEditorStore.getState().startRecording({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await injectNetworkRecorder(tabId);
  } catch (err) {
    console.warn("[bugshot] network recorder injection failed", err);
  }
  try {
    await videoRecorder.startRecording(tabId);
  } catch (err) {
    console.warn("[bugshot] video recording failed to start", err);
    useEditorStore.getState().cancelRecording();
  }
}

function EmptyState({ onStartElement, onStartScreenshot, onStartVideo }: { onStartElement: () => void; onStartScreenshot: () => void; onStartVideo: () => void }) {
  const t = useT();
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        <div className="flex flex-col items-center gap-1">
          <div className="mb-1 rounded-full bg-muted p-3">
            <Bug className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="whitespace-pre-line text-center text-[18px] font-semibold">{t("issue.empty.title")}</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button className="col-span-2" onClick={onStartElement}>
            <Crosshair />
            {t("issue.mode.element")}
          </Button>
          <Button variant="outline" onClick={onStartScreenshot}>
            <Camera />
            {t("issue.mode.screenshot")}
          </Button>
          <Button variant="outline" onClick={onStartVideo}>
            <Video />
            {t("issue.mode.video")}
          </Button>
        </div>
      </div>
    </PageShell>
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-red-100 p-3">
          <Video className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("issue.recording.title", { time: timeStr })}</h3>
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

function SubmitSuccessView() {
  const t = useT();
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
        <h3 className="text-[18px] font-semibold">{t("jira.submitted")}</h3>
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
            {t("app.tab.issueList")}
          </Button>
          <Button onClick={() => reset()}>
            {t("common.ok")}
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
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">{icon}</div>
      <h3 className="whitespace-pre-line text-[18px] font-semibold">{title}</h3>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
