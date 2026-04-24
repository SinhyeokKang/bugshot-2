import { useEffect } from "react";
import {
  ArrowUpRight,
  Bug,
  Camera,
  CircleCheck,
  Crosshair,
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
import { startPicker, stopPicker } from "../picker-control";
import { PageShell } from "../components/Section";
import { useTabNav } from "../App";
import { DraftingPanel } from "./DraftingPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SelectedPanel } from "./StyleEditorPanel";

export function IssueTab() {
  const phase = useEditorStore((s) => s.phase);
  const selection = useEditorStore((s) => s.selection);
  const reset = useEditorStore((s) => s.reset);
  const sessionExpired = useEditorStore((s) => s.sessionExpired);
  const tabId = useBoundTabId();
  useEffect(() => {
    if (!tabId) return;
    if (useEditorStore.getState().phase === "idle") {
      void captureElementSnapshot(tabId).then((img) => {
        if (img) useEditorStore.getState().setBeforeImage(img);
      });
    }
    const unsub = useEditorStore.subscribe((state, prev) => {
      const p = state.phase;
      if (p === "styling" && prev.phase === "picking") {
        void captureElementSnapshot(tabId).then((img) => {
          if (img) useEditorStore.getState().setBeforeImage(img);
        });
      } else if (p !== "idle") {
        // noop
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

  if (phase === "idle" || !selection) {
    return <EmptyState onStartElement={() => void startPicker(tabId)} />;
  }

  if (phase === "drafting") {
    return (
      <>
        <DraftingPanel />
        <SessionExpiredDialog
          open={sessionExpired}
          onConfirm={() => {
            reset();
            if (tabId) void startPicker(tabId);
          }}
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

  return (
    <>
      <SelectedPanel />
      <SessionExpiredDialog
        open={sessionExpired}
        onConfirm={() => {
          reset();
          if (tabId) void startPicker(tabId);
        }}
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

function EmptyState({ onStartElement }: { onStartElement: () => void }) {
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
          <Button variant="outline" disabled>
            <Camera />
            화면 캡처
          </Button>
          <Button variant="outline" disabled>
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

function SubmitSuccessView() {
  const submitResult = useEditorStore((s) => s.submitResult);
  const reset = useEditorStore((s) => s.reset);
  const tabId = useBoundTabId();
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
          <Button
            onClick={() => {
              reset();
              if (tabId) void startPicker(tabId);
            }}
          >
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
