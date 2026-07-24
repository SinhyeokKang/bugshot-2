import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiAsana } from "@icons-pack/react-simple-icons";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { ConnectedBadge } from "@/sidepanel/components/ConnectedBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings-store";
import type { AsanaAccount, AsanaMyself, AsanaOAuthAuth } from "@/types/asana";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { AssigneeCombobox, type AssigneeValue as AsanaAssigneeValue } from "@/sidepanel/tabs/asanaFields/AssigneeCombobox";
import { ProjectCombobox, type ProjectValue } from "@/sidepanel/tabs/asanaFields/ProjectCombobox";
import { WorkspaceCombobox, type WorkspaceValue } from "@/sidepanel/tabs/asanaFields/WorkspaceCombobox";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";

const ASANA_TOKEN_SETTINGS = "https://app.asana.com/0/my-apps";

export function AsanaConnectedBody() {
  return (
    <>
      <AsanaSummary />
      <DefaultWorkspaceField />
      <DefaultProjectField />
      <DefaultAssigneeField />
    </>
  );
}

export function AsanaConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [patOpen, setPatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "asana.oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setConnecting(true);
    try {
      const auth = await sendBg<AsanaOAuthAuth>({ type: "asana.startOAuth" });
      const next: AsanaAccount = {
        platform: "asana",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      };
      setAccount("asana", next);
      onConnected();
    } catch (err) {
      if (!isOAuthCancelled(err)) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  const methods = connectMethods(oauthAvailable);

  function handleClick() {
    if (methods.length === 0) return;
    if (connecting) return;
    if (methods.includes("oauth")) {
      setMethodOpen(true);
    } else {
      setPatOpen(true);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={connected || methods.length === 0}
        aria-disabled={connecting}
        className="relative w-full justify-center gap-2 aria-disabled:cursor-not-allowed"
      >
        {connecting && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={`inline-flex items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
          <SiAsana className="h-4 w-4" color="default" />
          {connected
            ? t("platform.connected", { platform: t("platform.tab.asana") })
            : t("platform.connectPlatform", { platform: t("platform.tab.asana") })}
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={t("platform.tab.asana")}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t("asana.patButton")}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setPatOpen(true)}
      />
      <PatDialog open={patOpen} onOpenChange={setPatOpen} onConnected={onConnected} />
    </>
  );
}

function DefaultWorkspaceField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.asana);
  const updateAsanaAccount = useSettingsStore((s) => s.updateAsanaAccount);
  if (!account) return null;
  const value: WorkspaceValue | null =
    account.defaults.workspaceGid && account.defaults.workspaceName
      ? {
          workspaceGid: account.defaults.workspaceGid,
          workspaceName: account.defaults.workspaceName,
        }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("asana.section.workspace")}</label>
      <WorkspaceCombobox
        value={value}
        onChange={(next) =>
          // project·assignee는 workspace 하위 값이라 workspace가 바뀌면 함께 비운다.
          updateAsanaAccount({
            defaults: {
              ...account.defaults,
              workspaceGid: next?.workspaceGid,
              workspaceName: next?.workspaceName,
              projectGid: undefined,
              projectName: undefined,
              assigneeGid: undefined,
              assigneeName: undefined,
            },
          })
        }
      />
    </div>
  );
}

function DefaultProjectField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.asana);
  const updateAsanaAccount = useSettingsStore((s) => s.updateAsanaAccount);
  if (!account) return null;
  const value: ProjectValue | null =
    account.defaults.projectGid && account.defaults.projectName
      ? {
          projectGid: account.defaults.projectGid,
          projectName: account.defaults.projectName,
        }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("asana.section.project")}</label>
      <ProjectCombobox
        workspaceGid={account.defaults.workspaceGid}
        value={value}
        onChange={(next) =>
          updateAsanaAccount({
            defaults: next
              ? { ...account.defaults, projectGid: next.projectGid, projectName: next.projectName }
              : { ...account.defaults, projectGid: undefined, projectName: undefined },
          })
        }
      />
    </div>
  );
}

function DefaultAssigneeField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.asana);
  const updateAsanaAccount = useSettingsStore((s) => s.updateAsanaAccount);
  if (!account) return null;
  const value: AsanaAssigneeValue | null =
    account.defaults.assigneeGid && account.defaults.assigneeName
      ? { gid: account.defaults.assigneeGid, name: account.defaults.assigneeName }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("asana.field.assignee")}</label>
      <AssigneeCombobox
        workspaceGid={account.defaults.workspaceGid}
        value={value}
        onChange={(next) =>
          updateAsanaAccount({
            defaults: {
              ...account.defaults,
              assigneeGid: next?.gid,
              assigneeName: next?.name,
            },
          })
        }
      />
    </div>
  );
}

function PatDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [pat, setPat] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed = pat.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    if (validating) return;
    setValidating(true);
    try {
      const me = await sendBg<AsanaMyself>({
        type: "asana.testPat",
        pat: trimmed,
      });
      const next: AsanaAccount = {
        platform: "asana",
        connectedAt: Date.now(),
        auth: {
          kind: "pat",
          pat: trimmed,
          viewerGid: me.gid,
          viewerName: me.name,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      setAccount("asana", next);
      onConnected();
      setPat("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("asana.patDialog.title")}</DialogTitle>
          <DialogDescription>{t("asana.patDialog.body")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="asana-pat" className="text-xs text-muted-foreground">
              {t("asana.patLabel")}
            </label>
            <a
              href={ASANA_TOKEN_SETTINGS}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("platform.getToken")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Input
            id="asana-pat"
            placeholder={t("asana.patPlaceholder")}
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleValidate} disabled={!canValidate && !validating} aria-disabled={validating} className="relative aria-disabled:cursor-not-allowed">
            {validating && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={validating ? "opacity-0" : undefined}>
              {t("common.verify")}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AsanaSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.asana);
  if (!account) return null;
  const kindLabel =
    account.auth.kind === "oauth"
      ? t("asana.auth.kind.oauth")
      : t("asana.auth.kind.pat");
  const name = account.auth.viewerName || t("asana.viewerName");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{name}</span>
            <span className="truncate text-sm text-muted-foreground">
              {account.auth.viewerEmail || t("platform.tab.asana")}
            </span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
