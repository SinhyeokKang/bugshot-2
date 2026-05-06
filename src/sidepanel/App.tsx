import { createContext, useContext, useEffect, useState } from "react";
import { Globe, List, Settings, SlidersHorizontal, SquarePen } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PICKER_PORT_NAME, PANEL_PORT_PREFIX } from "@/lib/session-keys";
import { useEditorStore } from "@/store/editor-store";
import { connectedPlatforms, useSettingsStore } from "@/store/settings-store";
import {
  onBlobSaveFailed,
  onOAuthExpired,
  onPickerIframeUnsupported,
  onPickerUnavailable,
  onSessionSaveExhausted,
} from "@/types/messages";
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";

const TabNavContext = createContext<(tab: string) => void>(() => {});
export const useTabNav = () => useContext(TabNavContext);
import { useBoundTabId } from "./hooks/useBoundTabId";
import { useEditorSessionSync } from "./hooks/useEditorSessionSync";
import { usePickerMessages } from "./hooks/usePickerMessages";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { IntegrationsTab } from "./tabs/IntegrationsTab";
import { IssueListTab } from "./tabs/IssueListTab";
import { IssueTab } from "./tabs/IssueTab";
import { SettingsTab } from "./tabs/SettingsTab";

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

export default function App() {
  const t = useT();
  const tabId = useBoundTabId();
  const editorHydrated = useEditorSessionSync(tabId ?? null);
  const settingsHydrated = useSettingsHydrated();
  usePickerMessages();
  useThemeEffect();

  const accounts = useSettingsStore((s) => s.accounts);
  const [tab, setTab] = useState("issue");
  const [oauthExpiredPlatform, setOauthExpiredPlatform] = useState<PlatformId | null>(null);
  const [pickerUnavailable, setPickerUnavailable] = useState(false);
  const [iframeUnsupported, setIframeUnsupported] = useState(false);
  const [blobSaveFailed, setBlobSaveFailed] = useState(false);
  const [sessionSaveExhausted, setSessionSaveExhausted] = useState(false);

  useEffect(() => {
    if (settingsHydrated && connectedPlatforms(accounts).length === 0) {
      setTab("integrations");
    }
  }, [settingsHydrated, accounts]);

  useEffect(() => {
    const unsub = onOAuthExpired.subscribe((platform) => {
      // 프로그램매틱 dialog open 시 focused element가 root에 남아있으면
      // Radix의 aria-hidden과 충돌해 a11y 경고가 뜨므로 미리 blur.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setOauthExpiredPlatform(platform ?? "jira");
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onPickerUnavailable.subscribe(() => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setPickerUnavailable(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onPickerIframeUnsupported.subscribe(() => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setIframeUnsupported(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onBlobSaveFailed.subscribe(() => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setBlobSaveFailed(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSessionSaveExhausted.subscribe(() => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setSessionSaveExhausted(true);
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
    <TabNavContext.Provider value={setTab}>
    <div className="flex h-screen flex-col">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b">
          <TabsList className="mx-4 my-5 grid h-9 w-auto grid-cols-4">
            <TabsTrigger value="issue" className="gap-1.5">
              <SquarePen className="h-3.5 w-3.5" />
              {t("app.tab.issue")}
            </TabsTrigger>
            <TabsTrigger value="issue-list" className="gap-1.5">
              <List className="h-3.5 w-3.5" />
              {t("app.tab.issueList")}
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("app.tab.integrations")}
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              {t("app.tab.settings")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="issue"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <IssueTab />
        </TabsContent>

        <TabsContent
          value="issue-list"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <IssueListTab />
        </TabsContent>

        <TabsContent
          value="integrations"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <IntegrationsTab />
        </TabsContent>

        <TabsContent
          value="settings"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <SettingsTab />
        </TabsContent>
      </Tabs>

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.pickerUnavailable.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.pickerUnavailable.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setPickerUnavailable(false)}>
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={iframeUnsupported} onOpenChange={setIframeUnsupported}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.iframeUnsupported.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.iframeUnsupported.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setIframeUnsupported(false)}>
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
    </div>
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
      <h3 className="text-[18px] font-semibold">{t("app.unsupported.title")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("app.unsupported.body")}
      </p>
    </div>
  );
}
