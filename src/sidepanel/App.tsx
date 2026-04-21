import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IssueTab } from "./tabs/IssueTab";
import { SettingsTab } from "./tabs/SettingsTab";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Tabs
        defaultValue="issue"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b">
          <TabsList className="mx-4 my-5 grid h-9 w-auto grid-cols-2">
            <TabsTrigger value="issue">이슈 작성</TabsTrigger>
            <TabsTrigger value="settings">설정</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="issue"
          className="mt-0 flex-1 overflow-y-auto px-4 py-5"
        >
          <IssueTab />
        </TabsContent>

        <TabsContent
          value="settings"
          className="mt-0 flex-1 overflow-y-auto px-4 py-5"
        >
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
