import { useState } from "react";
import {
  SiGithub,
  SiJirasoftware,
  SiLinear,
  SiNotion,
} from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useSettingsStore } from "@/store/settings-store";
import { PageFooter } from "@/sidepanel/components/Section";
import type { PlatformId } from "@/types/platform";
import { GithubConnectForm } from "./connect/GithubConnectForm";
import { JiraConnectForm } from "./connect/JiraConnectForm";
import { LinearConnectForm } from "./connect/LinearConnectForm";
import { NotionConnectForm } from "./connect/NotionConnectForm";

type PlatformSubTab = "jira" | "github" | "linear" | "notion";

const PLATFORM_ORDER: PlatformSubTab[] = ["jira", "github", "linear", "notion"];

const PLATFORM_LABEL_KEYS: Record<PlatformSubTab, TranslationKey> = {
  jira: "platform.tab.jira",
  github: "platform.tab.github",
  linear: "platform.tab.linear",
  notion: "platform.tab.notion",
};

export function IntegrationsTab() {
  const t = useT();
  const accounts = useSettingsStore((s) => s.accounts);
  const removeAccount = useSettingsStore((s) => s.removeAccount);
  const removeAllAccounts = useSettingsStore((s) => s.removeAllAccounts);
  const [sub, setSub] = useState<PlatformSubTab>(
    () => PLATFORM_ORDER.find((p) => !!accounts[p]) ?? "jira",
  );

  const connectedCount = PLATFORM_ORDER.filter((p) => !!accounts[p]).length;
  const currentConnected = !!accounts[sub];

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => setSub(v as PlatformSubTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <TabsList className="grid h-9 w-full grid-cols-4">
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
          <TabsTrigger value="notion" className="gap-1.5">
            <SiNotion className="h-3.5 w-3.5 dark:invert" color="default" />
            {t("platform.tab.notion")}
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

      <TabsContent
        value="notion"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <NotionConnectForm />
      </TabsContent>

      {currentConnected && (
        <PageFooter>
          <div className="flex items-center justify-between">
            {connectedCount >= 2 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive">
                    {t("platform.disconnectAll")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("platform.disconnectAll.title")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("platform.disconnectAll.body")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { removeAllAccounts(); setSub("jira"); }}>
                      {t("platform.disconnect.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : <span />}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">
                  {t("platform.disconnectPlatform", { platform: t(PLATFORM_LABEL_KEYS[sub]) })}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("platform.disconnect.title", { platform: t(PLATFORM_LABEL_KEYS[sub]) })}</AlertDialogTitle>
                  <AlertDialogDescription>{t("platform.disconnect.body")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removeAccount(sub as PlatformId)}>
                    {t("platform.disconnect.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </PageFooter>
      )}
    </Tabs>
  );
}
