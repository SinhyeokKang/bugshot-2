import { createContext, useContext, useEffect, useState } from "react";
import { Globe, List, Settings, SlidersHorizontal, SquarePen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jiraCredentialsFilled, useSettingsStore } from "@/store/settings-store";

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
  const tabId = useBoundTabId();
  const editorHydrated = useEditorSessionSync(tabId);
  const settingsHydrated = useSettingsHydrated();
  usePickerMessages();
  useThemeEffect();

  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const [tab, setTab] = useState("issue");

  useEffect(() => {
    if (settingsHydrated && !jiraCredentialsFilled(jiraConfig)) {
      setTab("issue-settings");
    }
  }, [settingsHydrated]);

  useEffect(() => {
    if (tabId == null) return;
    const pickerPort = chrome.tabs.connect(tabId, { name: "bugshot-picker" });
    pickerPort.onDisconnect.addListener(() => {});
    const bgPort = chrome.runtime.connect({ name: `bugshot-panel:${tabId}` });
    bgPort.onDisconnect.addListener(() => {});
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
              이슈 작성
            </TabsTrigger>
            <TabsTrigger value="issue-list" className="gap-1.5">
              <List className="h-3.5 w-3.5" />
              이슈 목록
            </TabsTrigger>
            <TabsTrigger value="issue-settings" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Jira 연동
            </TabsTrigger>
            <TabsTrigger value="app-settings" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              앱 설정
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
    </div>
    </TabNavContext.Provider>
  );
}

function UnsupportedPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-muted p-3">
        <Globe className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-[18px] font-semibold">이 페이지에서는 사용할 수 없습니다</h3>
      <p className="text-sm text-muted-foreground">
        웹 페이지(http, https, file)에서 BugShot을 실행해주세요.
      </p>
    </div>
  );
}
