import { useState } from "react";
import { useT } from "@/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "../components/Section";
import { GithubConnectForm } from "./connect/GithubConnectForm";
import { JiraConnectForm } from "./connect/JiraConnectForm";

type PlatformSubTab = "jira" | "github";

export function SettingsTab() {
  const t = useT();
  const [sub, setSub] = useState<PlatformSubTab>("jira");

  return (
    <PageShell>
      <Tabs
        value={sub}
        onValueChange={(v) => setSub(v as PlatformSubTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="px-4 pt-4">
          <TabsList className="grid h-9 w-full grid-cols-2">
            <TabsTrigger value="jira">{t("platform.tab.jira")}</TabsTrigger>
            <TabsTrigger value="github">{t("platform.tab.github")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="jira"
          className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <JiraConnectForm />
        </TabsContent>

        <TabsContent
          value="github"
          className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <GithubConnectForm />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
