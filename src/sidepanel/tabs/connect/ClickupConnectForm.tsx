import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiClickup } from "@icons-pack/react-simple-icons";
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
import type { ClickupAccount, ClickupMyself, ClickupOAuthAuth } from "@/types/clickup";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { ListCombobox, type ListValue } from "@/sidepanel/tabs/clickupFields/ListCombobox";
import { SpaceCombobox, type SpaceValue } from "@/sidepanel/tabs/clickupFields/SpaceCombobox";
import { WorkspaceCombobox, type WorkspaceValue } from "@/sidepanel/tabs/clickupFields/WorkspaceCombobox";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";

const CLICKUP_TOKEN_SETTINGS = "https://app.clickup.com/settings/apps";

export function ClickupConnectedBody() {
  return (
    <>
      <ClickupSummary />
      <DefaultWorkspaceField />
      <DefaultSpaceField />
      <DefaultListField />
    </>
  );
}

export function ClickupConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [patOpen, setPatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "clickup.oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setConnecting(true);
    try {
      const auth = await sendBg<ClickupOAuthAuth>({ type: "clickup.startOAuth" });
      const next: ClickupAccount = {
        platform: "clickup",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      };
      setAccount("clickup", next);
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
        disabled={connected || connecting || methods.length === 0}
        className="relative w-full justify-center gap-2"
      >
        {connecting && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={`inline-flex items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
          <SiClickup className="h-4 w-4" color="default" />
          {connected
            ? t("platform.connected", { platform: t("platform.tab.clickup") })
            : t("platform.connectPlatform", { platform: t("platform.tab.clickup") })}
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={t("platform.tab.clickup")}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t("clickup.patButton")}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setPatOpen(true)}
      />
      <PatDialog open={patOpen} onOpenChange={setPatOpen} onConnected={onConnected} />
    </>
  );
}

function DefaultWorkspaceField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: WorkspaceValue | null =
    account.defaults.workspaceId && account.defaults.workspaceName
      ? {
          workspaceId: account.defaults.workspaceId,
          workspaceName: account.defaults.workspaceName,
        }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("clickup.section.workspace")}</label>
      <WorkspaceCombobox
        value={value}
        onChange={(next) =>
          updateClickupAccount({
            defaults: next
              ? { ...account.defaults, workspaceId: next.workspaceId, workspaceName: next.workspaceName, spaceId: undefined, spaceName: undefined, listId: undefined, listName: undefined }
              : { ...account.defaults, workspaceId: undefined, workspaceName: undefined, spaceId: undefined, spaceName: undefined, listId: undefined, listName: undefined },
          })
        }
      />
    </div>
  );
}

function DefaultSpaceField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: SpaceValue | null =
    account.defaults.spaceId && account.defaults.spaceName
      ? { spaceId: account.defaults.spaceId, spaceName: account.defaults.spaceName }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("clickup.section.space")}</label>
      <SpaceCombobox
        workspaceId={account.defaults.workspaceId}
        value={value}
        onChange={(next) =>
          updateClickupAccount({
            defaults: next
              ? { ...account.defaults, spaceId: next.spaceId, spaceName: next.spaceName, listId: undefined, listName: undefined }
              : { ...account.defaults, spaceId: undefined, spaceName: undefined, listId: undefined, listName: undefined },
          })
        }
      />
    </div>
  );
}

function DefaultListField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: ListValue | null =
    account.defaults.listId && account.defaults.listName
      ? { listId: account.defaults.listId, listName: account.defaults.listName }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("clickup.section.list")}</label>
      <ListCombobox
        spaceId={account.defaults.spaceId}
        value={value}
        onChange={(next) =>
          updateClickupAccount({
            defaults: next
              ? { ...account.defaults, listId: next.listId, listName: next.listName }
              : { ...account.defaults, listId: undefined, listName: undefined },
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
    setValidating(true);
    try {
      const me = await sendBg<ClickupMyself>({
        type: "clickup.testPat",
        pat: trimmed,
      });
      const next: ClickupAccount = {
        platform: "clickup",
        connectedAt: Date.now(),
        auth: {
          kind: "pat",
          pat: trimmed,
          viewerId: me.id,
          viewerName: me.name,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      setAccount("clickup", next);
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
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("clickup.patDialog.title")}</DialogTitle>
          <DialogDescription>{t("clickup.patDialog.body")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="clickup-pat" className="text-xs text-muted-foreground">
              {t("clickup.patLabel")}
            </label>
            <a
              href={CLICKUP_TOKEN_SETTINGS}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("platform.getToken")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Input
            id="clickup-pat"
            placeholder={t("clickup.patPlaceholder")}
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
          <Button onClick={handleValidate} disabled={!canValidate} className="relative">
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

function ClickupSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  if (!account) return null;
  const kindLabel =
    account.auth.kind === "oauth"
      ? t("clickup.auth.kind.oauth")
      : t("clickup.auth.kind.pat");
  const name = account.auth.viewerName || t("clickup.viewerName");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{name}</span>
            <span className="truncate text-sm text-muted-foreground">
              {account.auth.viewerEmail || t("platform.tab.clickup")}
            </span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
