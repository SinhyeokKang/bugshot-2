import { useState } from "react";
import { SiGithub, SiJirasoftware, SiLinear } from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettingsStore } from "@/store/settings-store";
import { GithubConnectForm } from "./connect/GithubConnectForm";
import { JiraConnectForm } from "./connect/JiraConnectForm";
import { LinearConnectForm } from "./connect/LinearConnectForm";

type PlatformSubTab = "jira" | "github" | "linear";

const PLATFORM_ORDER: PlatformSubTab[] = ["jira", "github", "linear"];

export function IntegrationsTab() {
  const t = useT();
  const accounts = useSettingsStore((s) => s.accounts);
  const [sub, setSub] = useState<PlatformSubTab>(
    () => PLATFORM_ORDER.find((p) => !!accounts[p]) ?? "jira",
  );

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => setSub(v as PlatformSubTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="jira" className="gap-1.5">
            <SiJirasoftware className="h-3.5 w-3.5" color="default" />
            {t("platform.tab.jira")}
          </TabsTrigger>
          <TabsTrigger value="github" className="gap-1.5">
            <SiGithub className="h-3.5 w-3.5 dark:invert" color="default" />
            {t("platform.tab.github")}
          </TabsTrigger>
          <TabsTrigger value="linear" className="gap-1.5">
            <SiLinear className="h-3.5 w-3.5" color="default" />
            {t("platform.tab.linear")}
          </TabsTrigger>
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

      <TabsContent
        value="linear"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <LinearConnectForm />
      </TabsContent>
    </Tabs>
  );
}
