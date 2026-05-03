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
import { startPicker, stopPicker, startAreaCapture, cancelAreaCapture, clearPicker, injectNetworkRecorder, injectConsoleRecorder } from "../picker-control";
import * as videoRecorder from "../video-recorder";
import { PageShell } from "../components/Section";
import { useTabNav } from "../App";
import { DraftingPanel } from "./DraftingPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SelectedPanel } from "./StyleEditorPanel";
import { NetworkLogPreviewDialog } from "../components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "../components/ConsoleLogPreviewDialog";
import type { NetworkRequest } from "@/types/network";
import type { ConsoleEntry } from "@/types/console";

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
    await injectConsoleRecorder(tabId);
  } catch (err) {
    console.warn("[bugshot] console recorder injection failed", err);
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
  // ▼▼▼ MOCK DIALOGS — 테스트 후 삭제 ▼▼▼
  const [netOpen, setNetOpen] = useState(false);
  const [conOpen, setConOpen] = useState(false);
  // ▲▲▲ MOCK DIALOGS ▲▲▲
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
        {/* ▼▼▼ MOCK BUTTONS — 테스트 후 삭제 ▼▼▼ */}
        <div className="grid grid-cols-2 gap-2 mt-4 w-full">
          <Button variant="secondary" size="sm" onClick={() => setNetOpen(true)}>Network Log</Button>
          <Button variant="secondary" size="sm" onClick={() => setConOpen(true)}>Console Log</Button>
        </div>
        <NetworkLogPreviewDialog open={netOpen} onOpenChange={setNetOpen} requests={MOCK_NETWORK_REQUESTS} attach={false} onToggleAttach={() => {}} />
        <ConsoleLogPreviewDialog open={conOpen} onOpenChange={setConOpen} entries={MOCK_CONSOLE_ENTRIES} startedAt={Date.now() - 60000} attach={false} onToggleAttach={() => {}} />
        {/* ▲▲▲ MOCK BUTTONS ▲▲▲ */}
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

// ▼▼▼ MOCK DATA — 테스트 후 삭제 ▼▼▼
const now = Date.now();
const MOCK_NETWORK_REQUESTS: NetworkRequest[] = [
  { id: "req-1", url: "https://api.example.com/v1/users/me", method: "GET", status: 200, statusText: "OK", startTime: now - 25000, durationMs: 142, requestHeaders: { Authorization: "***Bearer [masked]", Accept: "application/json" }, responseHeaders: { "content-type": "application/json", "x-request-id": "abc-123" }, responseBody: JSON.stringify({ id: 1, name: "John Doe" }), pageUrl: "https://example.com/dashboard", requestBodySize: 0, responseBodySize: 256, contentType: "application/json" },
  { id: "req-2", url: "https://api.example.com/v1/projects?page=1&limit=20", method: "GET", status: 200, statusText: "OK", startTime: now - 22000, durationMs: 89, requestHeaders: { Accept: "application/json" }, responseHeaders: { "content-type": "application/json" }, responseBody: JSON.stringify({ data: [{ id: 1, name: "Project A" }], total: 42 }), pageUrl: "https://example.com/dashboard", requestBodySize: 0, responseBodySize: 1024, contentType: "application/json" },
  { id: "req-3", url: "https://api.example.com/v1/projects", method: "POST", status: 201, statusText: "Created", startTime: now - 18000, durationMs: 312, requestHeaders: { "Content-Type": "application/json" }, responseHeaders: { "content-type": "application/json" }, requestBody: JSON.stringify({ name: "New Project" }), responseBody: JSON.stringify({ id: 3, name: "New Project" }), pageUrl: "https://example.com/dashboard", requestBodySize: 64, responseBodySize: 128, contentType: "application/json" },
  { id: "req-4", url: "https://api.example.com/v1/projects/99", method: "PUT", status: 404, statusText: "Not Found", startTime: now - 15000, durationMs: 45, requestHeaders: { "Content-Type": "application/json" }, responseHeaders: { "content-type": "application/json" }, requestBody: JSON.stringify({ name: "Updated" }), responseBody: JSON.stringify({ error: "NOT_FOUND", message: "Project 99 does not exist" }), pageUrl: "https://example.com/dashboard", requestBodySize: 32, responseBodySize: 80, contentType: "application/json" },
  { id: "req-5", url: "https://api.example.com/v1/upload/avatar", method: "POST", status: 413, statusText: "Payload Too Large", startTime: now - 12000, durationMs: 28, requestHeaders: { "Content-Type": "multipart/form-data" }, responseHeaders: { "content-type": "application/json" }, requestBody: { kind: "binary" }, responseBody: JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }), pageUrl: "https://example.com/settings", requestBodySize: 8388608, responseBodySize: 64, contentType: "application/json" },
  { id: "req-6", url: "https://api.example.com/v1/analytics/events", method: "POST", status: 500, statusText: "Internal Server Error", startTime: now - 8000, durationMs: 5023, requestHeaders: { "Content-Type": "application/json" }, responseHeaders: { "content-type": "application/json" }, requestBody: JSON.stringify({ events: [{ type: "click" }] }), responseBody: JSON.stringify({ error: "INTERNAL_ERROR", traceId: "xyz-789" }), pageUrl: "https://example.com/dashboard", requestBodySize: 96, responseBodySize: 128, contentType: "application/json" },
  { id: "req-7", url: "https://cdn.example.com/assets/logo.png", method: "GET", status: 200, statusText: "OK", startTime: now - 5000, durationMs: 18, requestHeaders: { Accept: "image/*" }, responseHeaders: { "content-type": "image/png" }, responseBody: { kind: "binary" }, pageUrl: "https://example.com/dashboard", requestBodySize: 0, responseBodySize: 24576, contentType: "image/png" },
  { id: "req-8", url: "https://api.example.com/v1/projects/1", method: "DELETE", status: 204, statusText: "No Content", startTime: now - 2000, durationMs: 198, requestHeaders: { Authorization: "***Bearer [masked]" }, responseHeaders: {}, pageUrl: "https://example.com/dashboard", requestBodySize: 0, responseBodySize: 0, contentType: "" },
];
const MOCK_CONSOLE_ENTRIES: ConsoleEntry[] = [
  { id: "con-1", level: "log", timestamp: now - 28000, args: "[App] Mounted successfully, version 2.4.1", pageUrl: "https://example.com/dashboard" },
  { id: "con-2", level: "info", timestamp: now - 25000, args: "[Router] Navigated to /dashboard", pageUrl: "https://example.com/dashboard" },
  { id: "con-3", level: "warn", timestamp: now - 20000, args: "Deprecation warning: `componentWillMount` has been renamed.", pageUrl: "https://example.com/dashboard" },
  { id: "con-4", level: "error", timestamp: now - 18000, args: "TypeError: Cannot read properties of undefined (reading 'map')", stack: "TypeError: Cannot read properties of undefined (reading 'map')\n    at ProjectList (index-abc123.js:1234:56)\n    at renderWithHooks (vendor-def456.js:5678:12)", pageUrl: "https://example.com/dashboard" },
  { id: "con-5", level: "warn", timestamp: now - 15000, args: "[API] Response took 5023ms for POST /v1/analytics/events", pageUrl: "https://example.com/dashboard" },
  { id: "con-6", level: "error", timestamp: now - 12000, args: "Unhandled Promise Rejection: NetworkError: Failed to fetch", stack: "NetworkError: Failed to fetch\n    at fetch (native)\n    at apiClient.post (index-abc123.js:456:12)", pageUrl: "https://example.com/settings" },
  { id: "con-7", level: "debug", timestamp: now - 10000, args: "[Store] State updated: { projects: 42, loading: false }", pageUrl: "https://example.com/dashboard" },
  { id: "con-8", level: "log", timestamp: now - 7000, args: "[WebSocket] Connection established to wss://realtime.example.com", pageUrl: "https://example.com/dashboard" },
  { id: "con-9", level: "error", timestamp: now - 3000, args: "ResizeObserver loop completed with undelivered notifications.", pageUrl: "https://example.com/dashboard" },
  { id: "con-10", level: "info", timestamp: now - 1000, args: "[Analytics] Batch sent: 12 events", pageUrl: "https://example.com/dashboard" },
];
// ▲▲▲ MOCK DATA — 테스트 후 삭제 ▲▲▲
