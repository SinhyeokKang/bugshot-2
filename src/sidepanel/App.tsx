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
import { jiraCredentialsFilled, useSettingsStore } from "@/store/settings-store";
import { onOAuthExpired, onPickerUnavailable } from "@/types/messages";

const TabNavContext = createContext<(tab: string) => void>(() => {});
export const useTabNav = () => useContext(TabNavContext);
import { useBoundTabId } from "./hooks/useBoundTabId";
import { useEditorSessionSync } from "./hooks/useEditorSessionSync";
import { usePickerMessages } from "./hooks/usePickerMessages";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { AppSettingsTab } from "./tabs/AppSettingsTab";
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
  const editorHydrated = useEditorSessionSync(tabId);
  const settingsHydrated = useSettingsHydrated();
  usePickerMessages();
  useThemeEffect();

  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const [tab, setTab] = useState("issue");
  const [oauthExpired, setOAuthExpired] = useState(false);
  const [pickerUnavailable, setPickerUnavailable] = useState(false);

  useEffect(() => {
    if (settingsHydrated && !jiraCredentialsFilled(jiraConfig)) {
      setTab("issue-settings");
    }
  }, [settingsHydrated]);

  useEffect(() => {
    const unsub = onOAuthExpired.subscribe(() => {
      // 프로그램매틱 dialog open 시 focused element가 root에 남아있으면
      // Radix의 aria-hidden과 충돌해 a11y 경고가 뜨므로 미리 blur.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setOAuthExpired(true);
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

  if (tabId == null) return <UnsupportedPage />;

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
            <TabsTrigger value="issue-settings" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("app.tab.settings")}
            </TabsTrigger>
            <TabsTrigger value="app-settings" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              {t("app.tab.appSettings")}
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
          value="issue-settings"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <SettingsTab />
        </TabsContent>

        <TabsContent
          value="app-settings"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <AppSettingsTab />
        </TabsContent>
      </Tabs>

      <AlertDialog open={oauthExpired} onOpenChange={setOAuthExpired}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.oauthExpired.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.oauthExpired.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => { setOAuthExpired(false); setTab("issue-settings"); }}>
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
