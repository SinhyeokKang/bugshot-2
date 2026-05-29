import { useEffect, useRef, useState, type ComponentType } from "react";
import { Blocks, Boxes, Plus, Trash2 } from "lucide-react";
import {
  SiGithub,
  SiJirasoftware,
  SiLinear,
  SiNotion,
} from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
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
import { connectedPlatforms, useSettingsStore } from "@/store/settings-store";
import { PageFooter, PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";
import {
  pickInitialSubTab,
  type ConnectFlowProps,
  type IntegrationSubTab,
} from "./integrationsTabUtils";
import { GithubConnectedBody, GithubConnectFlow } from "./connect/GithubConnectForm";
import { JiraConnectedBody, JiraConnectFlow } from "./connect/JiraConnectForm";
import { LinearConnectedBody, LinearConnectFlow } from "./connect/LinearConnectForm";
import { NotionConnectedBody, NotionConnectFlow } from "./connect/NotionConnectForm";

interface PlatformEntry {
  id: PlatformId;
  Icon: ComponentType<{ className?: string; color?: string }>;
  ConnectedBody: () => JSX.Element;
  ConnectFlow: (p: ConnectFlowProps) => JSX.Element;
  iconClassName?: string;
}

const PLATFORMS: PlatformEntry[] = [
  { id: "jira", Icon: SiJirasoftware, ConnectedBody: JiraConnectedBody, ConnectFlow: JiraConnectFlow },
  { id: "github", Icon: SiGithub, ConnectedBody: GithubConnectedBody, ConnectFlow: GithubConnectFlow, iconClassName: "dark:invert" },
  { id: "linear", Icon: SiLinear, ConnectedBody: LinearConnectedBody, ConnectFlow: LinearConnectFlow },
  { id: "notion", Icon: SiNotion, ConnectedBody: NotionConnectedBody, ConnectFlow: NotionConnectFlow, iconClassName: "dark:invert" },
];

export function IntegrationsTab({ activeMainTab }: { activeMainTab: string }) {
  const t = useT();
  const accounts = useSettingsStore((s) => s.accounts);
  const removeAllAccounts = useSettingsStore((s) => s.removeAllAccounts);

  const connected = connectedPlatforms(accounts);
  const connectedCount = connected.length;

  const [sub, setSub] = useState<IntegrationSubTab>(() =>
    pickInitialSubTab(connectedCount),
  );

  // 상위 탭이 "integrations"로 전환되는 순간에만 진입 라우팅 (매 렌더 덮어쓰면 사용자 선택이 튐).
  const prevMainTab = useRef(activeMainTab);
  useEffect(() => {
    if (activeMainTab === "integrations" && prevMainTab.current !== "integrations") {
      setSub(pickInitialSubTab(connectedCount));
    }
    prevMainTab.current = activeMainTab;
  }, [activeMainTab, connectedCount]);

  // 해제로 connectedCount → 0 전이 시 "플랫폼 추가"로 자동 전환 (빈 "내 연동" 방지).
  const prevCount = useRef(connectedCount);
  useEffect(() => {
    if (prevCount.current > 0 && connectedCount === 0) {
      setSub("add");
    }
    prevCount.current = connectedCount;
  }, [connectedCount]);

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => setSub(v as IntegrationSubTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <TabsList className="grid h-9 w-full grid-cols-2">
          <TabsTrigger value="connected" className="gap-1.5">
            <Boxes className="h-4 w-4" />
            {t("platform.subtab.connected")}
          </TabsTrigger>
          <TabsTrigger value="add" className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("platform.subtab.add")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="connected"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        {connectedCount === 0 ? (
          <ConnectedEmpty onAdd={() => setSub("add")} />
        ) : (
          <>
            <PageScroll>
              {connected.map((id) => {
                const { Icon, ConnectedBody, iconClassName } = PLATFORMS.find(
                  (p) => p.id === id,
                )!;
                return (
                  <Section
                    key={id}
                    collapsible
                    defaultOpen
                    title={
                      <span className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${iconClassName ?? ""}`} color="default" />
                        {t(PLATFORM_TAB_KEYS[id])}
                      </span>
                    }
                    action={<DisconnectButton id={id} />}
                  >
                    <ConnectedBody />
                  </Section>
                );
              })}
            </PageScroll>
            {connectedCount >= 2 && (
              <PageFooter>
                <div className="flex justify-end">
                  <DisconnectAllButton onConfirm={removeAllAccounts} />
                </div>
              </PageFooter>
            )}
          </>
        )}
      </TabsContent>

      <TabsContent
        value="add"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <PageShell>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-5">
            <div className="flex flex-col items-center gap-1">
              <div className="mb-1 rounded-full bg-muted p-3">
                <Blocks className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-center text-lg font-semibold">{t("platform.add.title")}</h3>
            </div>
            <div className="flex w-full max-w-[320px] flex-col gap-2">
              {PLATFORMS.map(({ id, ConnectFlow }) => (
                <ConnectFlow
                  key={id}
                  connected={!!accounts[id]}
                  onConnected={() => setSub("connected")}
                />
              ))}
            </div>
          </div>
        </PageShell>
      </TabsContent>
    </Tabs>
  );
}

function ConnectedEmpty({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-5">
        <div className="flex flex-col items-center gap-1">
          <div className="mb-1 rounded-full bg-muted p-3">
            <Blocks className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-center text-lg font-semibold">{t("platform.add.empty.title")}</h3>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            {t("platform.add.empty.body")}
          </p>
        </div>
        <Button onClick={onAdd}>{t("platform.subtab.add")}</Button>
      </div>
    </PageShell>
  );
}

function DisconnectButton({ id }: { id: PlatformId }) {
  const t = useT();
  const removeAccount = useSettingsStore((s) => s.removeAccount);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("platform.disconnect.title", { platform: t(PLATFORM_TAB_KEYS[id]) })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("platform.disconnect.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => removeAccount(id)}>
            {t("platform.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DisconnectAllButton({ onConfirm }: { onConfirm: () => void }) {
  const t = useT();
  return (
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
          <AlertDialogAction onClick={onConfirm}>
            {t("platform.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
