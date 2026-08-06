import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Blocks, Globe, List, Loader2, Settings, Square, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { PICKER_PORT_NAME, PANEL_PORT_PREFIX, pendingKey } from "@/lib/session-keys";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { use30sReplay } from "./30s-replay/use-30s-replay";
import { useTabUnsupported } from "./hooks/useTabSupport";
import { TabSupportProvider } from "./hooks/tab-support-context";
import { ReplayProvider } from "./30s-replay/replay-context";
import {
  onBlobSaveFailed,
  onStateSaveFailed,
  onOAuthExpired,
  onPickerIframeUnsupported,
  onPickerPermissionExpired,
  onPickerUnavailable,
  onSessionSaveExhausted,
} from "@/types/messages";
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";
import { useBoundTabId } from "./hooks/useBoundTabId";
import { useEditorSessionSync } from "./hooks/useEditorSessionSync";
import { useBackgroundRecorder } from "./hooks/useBackgroundRecorder";
import { usePickerMessages } from "./hooks/usePickerMessages";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useAiLoadingStep } from "./hooks/useAiLoadingStep";
import { aiLoadingSurface, aiLoadingPhraseKey, type AiLoadingSurface } from "./lib/aiLoadingPhrases";
import { AiLoadingText } from "./components/AiLoadingText";
import { Button } from "@/components/ui/button";
import { DebugTab } from "./tabs/DebugTab";
import { IntegrationsTab } from "./tabs/IntegrationsTab";
import { IssueListTab } from "./tabs/IssueListTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { TabNavContext } from "./tab-nav";
import { applyReplayTrim, applyRecordingTrim, TrimLogsPersistError } from "./30s-replay/apply-trim";
import { clearPicker } from "@/sidepanel/picker-control";
import {
  attachDeviceViewport,
  dismissDeviceLoopWarning,
  setDeviceViewportUnsupported,
  useDeviceViewportStore,
} from "@/sidepanel/device-viewport-controller";
import {
  deleteNetworkLog,
  deleteConsoleLog,
  deleteActionLog,
  deleteVideoBlob,
  deleteAttachmentBlobs,
} from "@/store/blob-db";

const ReplayTrimDialog = lazy(() => import("./tabs/ReplayTrimDialog"));

function useSettingsHydrated() {
  const [ready, setReady] = useState(
    useSettingsStore.persist.hasHydrated(),
  );
  useEffect(
    () => useSettingsStore.persist.onFinishHydration(() => setReady(true)),
    [],
  );
  return ready;
}

// 프로그램매틱 dialog open 시 focused element가 root에 남아있으면
// Radix의 aria-hidden과 충돌해 a11y 경고가 뜨므로 미리 blur.
function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
}

const AI_OVERLAY_STYLE: Record<
  AiLoadingSurface,
  { tint: string; ripple: string; text: string; button: string }
> = {
  styling: {
    tint: "bg-teal-500/5",
    ripple: "bg-[radial-gradient(circle,transparent_0%,rgba(45,212,191,0.1)_46%,transparent_141%)]",
    text: "text-teal-700 dark:text-teal-300",
    button:
      "bg-teal-500/20 text-teal-700 hover:bg-teal-500/30 hover:text-teal-800 dark:bg-teal-400/20 dark:text-teal-300 dark:hover:bg-teal-400/30 dark:hover:text-teal-200",
  },
  draft: {
    tint: "bg-purple-500/5",
    ripple: "bg-[radial-gradient(circle,transparent_0%,rgba(192,132,252,0.1)_46%,transparent_141%)]",
    text: "text-purple-700 dark:text-purple-300",
    button:
      "bg-purple-500/20 text-purple-700 hover:bg-purple-500/30 hover:text-purple-800 dark:bg-purple-400/20 dark:text-purple-300 dark:hover:bg-purple-400/30 dark:hover:text-purple-200",
  },
  repro: {
    tint: "bg-amber-500/5",
    ripple: "bg-[radial-gradient(circle,transparent_0%,rgba(251,191,36,0.1)_46%,transparent_141%)]",
    text: "text-amber-700 dark:text-amber-300",
    button:
      "bg-amber-500/20 text-amber-700 hover:bg-amber-500/30 hover:text-amber-800 dark:bg-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-400/30 dark:hover:text-amber-200",
  },
};

export default function App() {
  const t = useT();
  const tabId = useBoundTabId();
  const editorHydrated = useEditorSessionSync(tabId ?? null);
  useBackgroundRecorder(tabId ?? null);
  const replayEnabled = useSettingsUiStore((s) => s.replayEnabled);
  const unsupported = useTabUnsupported(tabId);
  // 웹스토어는 https라 captureVisibleTab이 실제로 성공한다 — 안 막으면 "캡처할 수 없습니다"
  // 화면에서 프레임 버퍼가 계속 채워진다.
  const replay = use30sReplay(tabId ?? null, replayEnabled, unsupported);
  const settingsHydrated = useSettingsHydrated();
  usePickerMessages(tabId ?? null);
  useThemeEffect();

  // 디바이스 뷰포트 push 리스너는 **패널 루트가 소유한다** — 세그먼트 행은 작성 플로우에서
  // 언마운트되는데 재수립이 가장 필요한 구간이 정확히 거기라, 컴포넌트 수명에 매달면
  // 작성 중 handoff가 통째로 유실된다.
  useEffect(() => {
    if (tabId == null) return;
    return attachDeviceViewport(tabId);
  }, [tabId]);
  useEffect(() => {
    setDeviceViewportUnsupported(unsupported);
  }, [unsupported]);

  const aiStylingLoading = useEditorStore((s) => s.aiStylingLoading);
  const aiDraftLoading = useEditorStore((s) => s.aiDraftLoading);
  const reproPrefillLoading = useEditorStore((s) => s.reproPrefillLoading);
  const aiSurface = aiLoadingSurface({
    styling: aiStylingLoading,
    draft: aiDraftLoading,
    repro: reproPrefillLoading,
  });
  const aiStep = useAiLoadingStep(aiSurface, 3000);
  const replayTrim = useEditorStore((s) => s.replayTrim);
  const [tab, setTab] = useState("debug");
  const [settingsSub, setSettingsSub] = useState("issue");
  const navTo = useCallback((next: string, sub?: string) => {
    setTab(next);
    if (sub) setSettingsSub(sub);
  }, []);
  const [oauthExpiredPlatform, setOauthExpiredPlatform] = useState<PlatformId | null>(null);
  const [pickerUnavailable, setPickerUnavailable] = useState(false);
  const [iframeUnsupported, setIframeUnsupported] = useState(false);
  // 이 분기는 폭만 필요하므로 훅이 아니라 컨트롤러 스토어를 직접 읽는다.
  const deviceWidth = useDeviceViewportStore((s) => s.width);
  const deviceLoopWarning = useDeviceViewportStore((s) => s.loopWarning);
  const [blobSaveFailed, setBlobSaveFailed] = useState(false);
  const [stateSaveFailed, setStateSaveFailed] = useState(false);
  const [sessionSaveExhausted, setSessionSaveExhausted] = useState(false);
  const [permissionExpired, setPermissionExpired] = useState(false);
  const [trimBusy, setTrimBusy] = useState(false);
  const [trimProgress, setTrimProgress] = useState(0);

  useEffect(() => {
    const unsub = onOAuthExpired.subscribe((platform) => {
      blurActiveElement();
      setOauthExpiredPlatform(platform ?? "jira");
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onPickerUnavailable.subscribe(() => {
      blurActiveElement();
      setPickerUnavailable(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onPickerIframeUnsupported.subscribe(() => {
      blurActiveElement();
      setIframeUnsupported(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onBlobSaveFailed.subscribe(() => {
      blurActiveElement();
      setBlobSaveFailed(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onStateSaveFailed.subscribe(() => {
      blurActiveElement();
      setStateSaveFailed(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSessionSaveExhausted.subscribe(() => {
      blurActiveElement();
      setSessionSaveExhausted(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onPickerPermissionExpired.subscribe(() => {
      blurActiveElement();
      setPermissionExpired(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (tabId == null) return;
    const pickerPort = chrome.tabs.connect(tabId, { name: PICKER_PORT_NAME });
    pickerPort.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      const { phase, captureMode } = useEditorStore.getState();
      if (captureMode === "screenshot" && phase === "capturing") {
        useEditorStore.getState().reset();
      }
    });
    const bgPort = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
    bgPort.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
    });
    return () => {
      try { pickerPort.disconnect(); } catch {}
      try { bgPort.disconnect(); } catch {}
    };
  }, [tabId]);

  if (!editorHydrated || !settingsHydrated) return null;

  if (tabId === undefined) return null;
  if (tabId === null) return <UnsupportedPage />;

  return (
    <TabNavContext.Provider value={navTo}>
    <TabSupportProvider value={unsupported}>
    <ReplayProvider
      value={{
        replayEnabled,
        isReady: replay.isReady,
        isEncoding: replay.isEncoding,
        bufferedSeconds: replay.bufferedSeconds,
        capture: replay.capture,
        trimming: replayTrim != null,
      }}
    >
    <div className="relative flex h-screen flex-col">
      {aiSurface && (
        <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-[2px]">
          <div className={cn("absolute inset-0", AI_OVERLAY_STYLE[aiSurface].tint)} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
              key={aiStep}
              className={cn(
                "h-[240vh] w-[240vh] animate-ai-ripple rounded-full blur-3xl motion-reduce:animate-none",
                AI_OVERLAY_STYLE[aiSurface].ripple,
              )}
            />
          </div>
          <div className="relative z-10 flex animate-text-breathe items-center justify-center px-6 motion-reduce:animate-none">
            <AiLoadingText
              text={t(aiLoadingPhraseKey(aiSurface, aiStep))}
              className={cn("text-xl font-semibold", AI_OVERLAY_STYLE[aiSurface].text)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useEditorStore.getState().aiCancel?.()}
            className={cn(
              "absolute bottom-8 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full shadow-sm [&_svg]:size-3.5",
              AI_OVERLAY_STYLE[aiSurface].button,
            )}
          >
            <Square className="fill-current" />
            {t("ai.stop")}
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b px-4 py-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v)}>
            <CollapsingTabsList className="grid h-9 w-full grid-cols-4">
              <TabsTrigger value="debug" className="min-w-0 gap-1.5" data-testid="tab-debug">
                <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("app.tab.debug")}</TabLabel>
              </TabsTrigger>
              <TabsTrigger value="issue-list" className="min-w-0 gap-1.5" data-testid="tab-issue-list">
                <List className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("app.tab.issueList")}</TabLabel>
              </TabsTrigger>
              <TabsTrigger value="integrations" className="min-w-0 gap-1.5" data-testid="tab-integrations">
                <Blocks className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("app.tab.integrations")}</TabLabel>
              </TabsTrigger>
              <TabsTrigger value="settings" className="min-w-0 gap-1.5" data-testid="tab-settings">
                <Settings className="h-3.5 w-3.5 shrink-0" />
                <TabLabel>{t("app.tab.settings")}</TabLabel>
              </TabsTrigger>
            </CollapsingTabsList>
          </Tabs>
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", tab !== "debug" && "hidden")}>
          <DebugTab activeMainTab={tab} />
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", tab !== "issue-list" && "hidden")}>
          <IssueListTab />
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", tab !== "integrations" && "hidden")}>
          <IntegrationsTab activeMainTab={tab} />
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", tab !== "settings" && "hidden")}>
          <SettingsTab sub={settingsSub} onSubChange={setSettingsSub} />
        </div>
      </div>

      <AlertDialog
        open={oauthExpiredPlatform != null}
        onOpenChange={(v) => !v && setOauthExpiredPlatform(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("platform.oauthExpired.title", {
                platform: t(PLATFORM_TAB_KEYS[oauthExpiredPlatform ?? "jira"]),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("platform.oauthExpired.body", {
                platform: t(PLATFORM_TAB_KEYS[oauthExpiredPlatform ?? "jira"]),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setOauthExpiredPlatform(null);
                setTab("integrations");
              }}
            >
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pickerUnavailable} onOpenChange={setPickerUnavailable}>
        <AlertDialogContent data-testid="picker-unavailable-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.pickerUnavailable.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.pickerUnavailable.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setPickerUnavailable(false)} data-testid="picker-unavailable-ok">
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 재수립은 작성·녹화 중에도 도는데 뷰포트 행은 그 구간에 없다 — 루프 경고는 행이 아니라
          패널 루트가 소유해야 무음 유실되지 않는다. 강제 확인형이라 onOpenChange를 두지 않는다
          (Esc로 닫으면 모드가 해제되지 않은 채 다이얼로그만 사라진다). */}
      <AlertDialog open={deviceLoopWarning}>
        <AlertDialogContent data-testid="device-loop-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("issue.device.loop.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("issue.device.loop.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={dismissDeviceLoopWarning}>
              {t("issue.device.loop.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={iframeUnsupported} onOpenChange={setIframeUnsupported}>
        <AlertDialogContent data-testid="iframe-unsupported-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.iframeUnsupported.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* 모드 ON에서는 페이지 전체가 이미 프레임 하나라 페이지 안 iframe이 전부
                  2-depth가 된다 — 진짜 액션이 "스크린샷 모드"가 아니라 "뷰포트 되돌리기"다.
                  거부 발화점(picker.ts)은 자신이 래퍼 안인지 모르므로 렌더 시점에 가른다. */}
              {t(
                deviceWidth != null
                  ? "app.iframeUnsupported.bodyDeviceMode"
                  : "app.iframeUnsupported.body",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setIframeUnsupported(false)} data-testid="iframe-unsupported-ok">
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blobSaveFailed} onOpenChange={setBlobSaveFailed}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.blobSaveFailed.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.blobSaveFailed.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBlobSaveFailed(false)}>
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stateSaveFailed} onOpenChange={setStateSaveFailed}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.stateSaveFailed.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.stateSaveFailed.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setStateSaveFailed(false)}>
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={sessionSaveExhausted} onOpenChange={setSessionSaveExhausted}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.sessionSaveExhausted.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.sessionSaveExhausted.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSessionSaveExhausted(false)}>
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={permissionExpired}
        onOpenChange={setPermissionExpired}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.permissionExpired.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.permissionExpired.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => window.close()}>
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DraftingPanel(IssueTab)과 같은 값을 봐야 둘이 절대 동시에 마운트되지 않는다 —
          두 lazy 청크 동시 첫 로드는 tiptap 레이스로 흰 화면이 됐다(POSTMORTEM 2026-07-01). */}
      {replayTrim && (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <ReplayTrimDialog
            videoBlob={replayTrim.videoBlob}
            source={replayTrim.source}
            busy={trimBusy}
            // 리플레이(frames) 트림은 진행률을 내지 않는다(프레임이 메모리에 있어 즉시 끝난다) —
            // undefined를 넘겨 다이얼로그가 0% 바 대신 기존 readout을 유지하게 한다.
            progress={replayTrim.source.kind === "recording" ? trimProgress : undefined}
            onConfirm={({ startSec, endSec, durationSec, mediaScale }) => {
              const { source, ownerTabId, videoBlob } = replayTrim;
              // 오버레이는 탭을 전환해도 남는다(hydrate가 merge). 그 상태로 확정하면 남의 탭
              // 로그를 자르므로, 원본을 유지한 채 작성 화면으로 보낸다.
              if (ownerTabId !== tabId) {
                toast.error(t("issue.replay.trim.wrongTab"));
                replay.resolveTrim();
                return;
              }
              setTrimBusy(true);
              setTrimProgress(0);
              const done =
                source.kind === "recording"
                  ? applyRecordingTrim({
                      videoBlob,
                      tabId,
                      startedAt: source.startedAt,
                      startSec,
                      endSec,
                      durationSec,
                      mediaScale,
                      // 인코딩은 rVFC 콜백마다(4배속이면 초당 수십 회) 진행률을 낸다.
                      // 정수 %가 바뀔 때만 반영해 App 서브트리 리렌더가 인코더와 CPU를 다투지 않게 한다.
                      onProgress: (ratio) =>
                        setTrimProgress((prev) =>
                          Math.round(ratio * 100) === Math.round(prev * 100) ? prev : ratio,
                        ),
                    })
                  : applyReplayTrim({ frames: source.frames, tabId, startSec, endSec });
              done
                .catch((err) =>
                  toast.error(
                    // 로그 저장 실패는 replaceVideo 뒤라 잘린 영상이 이미 붙어 있다 —
                    // "원본이 첨부된다"는 인코딩 실패 문구를 쓰면 거짓말이 된다.
                    err instanceof TrimLogsPersistError
                      ? t("issue.replay.trim.logsPersistFailed")
                      : t("issue.replay.trimFailed"),
                  ),
                )
                .finally(() => {
                  setTrimBusy(false);
                  setTrimProgress(0);
                  replay.resolveTrim();
                });
            }}
            onCancel={() => {
              // confirm과 같은 소유권 가드. 이쪽이 비가역 삭제라 오히려 더 엄해야 한다 —
              // 소유 탭이 아니면 남의 pending 로그·영상을 지우지 않고 오버레이만 닫는다.
              if (replayTrim.ownerTabId !== tabId) {
                toast.error(t("issue.replay.trim.wrongTabDiscard"));
                replay.resolveTrim();
                return;
              }
              useEditorStore.getState().reset(); // ...initial이 replayTrim까지 청소 — resolveTrim 불요.
              void clearPicker(tabId);
              void deleteNetworkLog(pendingKey(tabId));
              void deleteConsoleLog(pendingKey(tabId));
              void deleteActionLog(pendingKey(tabId));
              void deleteVideoBlob(pendingKey(tabId));
              void deleteAttachmentBlobs(pendingKey(tabId));
            }}
          />
        </Suspense>
      )}
    </div>
    <Toaster position="top-center" offset={24} />
    </ReplayProvider>
    </TabSupportProvider>
    </TabNavContext.Provider>
  );
}

function UnsupportedPage() {
  const t = useT();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-muted p-3">
        <Globe className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{t("app.unsupported.title")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("app.unsupported.body")}
      </p>
    </div>
  );
}
