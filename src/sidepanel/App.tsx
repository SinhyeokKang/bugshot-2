import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Blocks, Globe, List, Loader2, Settings, TerminalSquare } from "lucide-react";
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
import { PICKER_PORT_NAME, PANEL_PORT_PREFIX } from "@/lib/session-keys";
import { useEditorStore, useAiLoading } from "@/store/editor-store";
import { connectedPlatforms, useSettingsStore } from "@/store/settings-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { use30sReplay } from "./30s-replay/use-30s-replay";
import { ReplayProvider } from "./30s-replay/replay-context";
import {
  onBlobSaveFailed,
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
import { DebugTab } from "./tabs/DebugTab";
import { IntegrationsTab } from "./tabs/IntegrationsTab";
import { IssueListTab } from "./tabs/IssueListTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { TabNavContext } from "./tab-nav";
import { applyReplayTrim } from "./30s-replay/apply-trim";
import { clearPicker } from "@/sidepanel/picker-control";
import {
  deleteNetworkLog,
  deleteConsoleLog,
  deleteActionLog,
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

export default function App() {
  const t = useT();
  const tabId = useBoundTabId();
  const editorHydrated = useEditorSessionSync(tabId ?? null);
  useBackgroundRecorder(tabId ?? null);
  const replayEnabled = useSettingsUiStore((s) => s.replayEnabled);
  const replay = use30sReplay(tabId ?? null, replayEnabled);
  const settingsHydrated = useSettingsHydrated();
  usePickerMessages(tabId ?? null);
  useThemeEffect();

  const accounts = useSettingsStore((s) => s.accounts);
  const aiLoading = useAiLoading();
  const aiStylingLoading = useEditorStore((s) => s.aiStylingLoading);
  const [tab, setTab] = useState("debug");
  const [settingsSub, setSettingsSub] = useState("issue");
  const navTo = useCallback((next: string, sub?: string) => {
    setTab(next);
    if (sub) setSettingsSub(sub);
  }, []);
  const [oauthExpiredPlatform, setOauthExpiredPlatform] = useState<PlatformId | null>(null);
  const [pickerUnavailable, setPickerUnavailable] = useState(false);
  const [iframeUnsupported, setIframeUnsupported] = useState(false);
  const [blobSaveFailed, setBlobSaveFailed] = useState(false);
  const [sessionSaveExhausted, setSessionSaveExhausted] = useState(false);
  const [permissionExpired, setPermissionExpired] = useState(false);
  const [trimBusy, setTrimBusy] = useState(false);

  useEffect(() => {
    if (settingsHydrated && connectedPlatforms(accounts).length === 0) {
      setTab("integrations");
    }
  }, [settingsHydrated, accounts]);

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
    <ReplayProvider
      value={{
        replayEnabled,
        isReady: replay.isReady,
        isEncoding: replay.isEncoding,
        bufferedSeconds: replay.bufferedSeconds,
        capture: replay.capture,
      }}
    >
    <div className="relative flex h-screen flex-col">
      {aiLoading && (
        <div className="absolute inset-0 z-50 overflow-hidden backdrop-blur-[2px]">
          <div className={cn("absolute inset-0", aiStylingLoading ? "bg-teal-500/5" : "bg-purple-500/5")} />
          <div className={cn("absolute inset-0 animate-shimmer bg-gradient-to-b from-transparent to-transparent", aiStylingLoading ? "via-teal-400/10" : "via-purple-400/10")} />
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

      <AlertDialog open={iframeUnsupported} onOpenChange={setIframeUnsupported}>
        <AlertDialogContent data-testid="iframe-unsupported-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.iframeUnsupported.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.iframeUnsupported.body")}
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

      {replay.pendingTrim && (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <ReplayTrimDialog
            videoBlob={replay.pendingTrim.videoBlob}
            frames={replay.pendingTrim.frames}
            busy={trimBusy}
            onConfirm={(startSec, endSec) => {
              const frames = replay.pendingTrim?.frames ?? [];
              setTrimBusy(true);
              applyReplayTrim({ frames, tabId, startSec, endSec })
                .catch(() => toast.error(t("issue.replay.encodeFailed")))
                .finally(() => {
                  setTrimBusy(false);
                  replay.resolveTrim();
                });
            }}
            onCancel={() => {
              replay.resolveTrim();
              useEditorStore.getState().reset();
              void clearPicker(tabId);
              void deleteNetworkLog(`pending:${tabId}`);
              void deleteConsoleLog(`pending:${tabId}`);
              void deleteActionLog(`pending:${tabId}`);
              void deleteAttachmentBlobs(`pending:${tabId}`);
            }}
          />
        </Suspense>
      )}
    </div>
    <Toaster position="top-center" offset={24} />
    </ReplayProvider>
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
