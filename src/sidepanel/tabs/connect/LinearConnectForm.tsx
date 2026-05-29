import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiLinear } from "@icons-pack/react-simple-icons";
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
import type {
  LinearAccount,
  LinearMyself,
  LinearOAuthAuth,
} from "@/types/linear";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { TeamCombobox, type TeamValue } from "@/sidepanel/tabs/linearFields/TeamCombobox";
import { ProjectCombobox } from "@/sidepanel/tabs/linearFields/ProjectCombobox";
import { LabelCombobox } from "@/sidepanel/tabs/linearFields/LabelCombobox";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";

export function LinearConnectedBody() {
  return (
    <>
      <LinearSummary />
      <DefaultTeamField />
      <DefaultIssueSettingsFields />
    </>
  );
}

export function LinearConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "linear.oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setConnecting(true);
    try {
      const auth = await sendBg<LinearOAuthAuth>({ type: "linear.startOAuth" });
      const next: LinearAccount = {
        platform: "linear",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      };
      setAccount("linear", next);
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
      setApiKeyOpen(true);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={connected || connecting || methods.length === 0}
        className="relative w-full justify-start gap-2"
      >
        {connecting && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={`inline-flex items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
          <SiLinear className="h-4 w-4" color="default" />
          {t("platform.connectPlatform", { platform: t("platform.tab.linear") })}
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={t("platform.tab.linear")}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t("linear.apiKeyButton")}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setApiKeyOpen(true)}
      />
      <ApiKeyDialog open={apiKeyOpen} onOpenChange={setApiKeyOpen} onConnected={onConnected} />
    </>
  );
}

function DefaultTeamField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.linear);
  const updateLinearAccount = useSettingsStore((s) => s.updateLinearAccount);
  if (!account) return null;

  const value: TeamValue | null =
    account.defaults.teamId && account.defaults.teamName
      ? {
          teamId: account.defaults.teamId,
          teamName: account.defaults.teamName,
          teamKey: account.defaults.teamKey ?? "",
        }
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("linear.section.team")}</label>
      <TeamCombobox
        value={value}
        onChange={(next) =>
          updateLinearAccount({
            defaults: next
              ? { ...account.defaults, teamId: next.teamId, teamName: next.teamName, teamKey: next.teamKey }
              : { teamId: undefined, teamName: undefined, teamKey: undefined, projectId: undefined, projectName: undefined, labelId: undefined },
          })
        }
      />
    </div>
  );
}

function DefaultIssueSettingsFields() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.linear);
  const updateLinearAccount = useSettingsStore((s) => s.updateLinearAccount);
  if (!account) return null;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("linear.field.project")}</label>
        <ProjectCombobox
          teamId={account.defaults.teamId}
          value={account.defaults.projectId}
          valueName={account.defaults.projectName}
          onChange={(projectId, projectName) =>
            updateLinearAccount({
              defaults: { ...account.defaults, projectId, projectName },
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("linear.field.labels")}</label>
        <LabelCombobox
          teamId={account.defaults.teamId}
          value={account.defaults.labelId}
          valueName={account.defaults.labelName}
          onChange={(labelId, labelName) =>
            updateLinearAccount({
              defaults: { ...account.defaults, labelId, labelName },
            })
          }
        />
      </div>
    </>
  );
}

function ApiKeyDialog({
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
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed = apiKey.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    setValidating(true);
    try {
      const me = await sendBg<LinearMyself>({
        type: "linear.testApiKey",
        apiKey: trimmed,
      });
      const next: LinearAccount = {
        platform: "linear",
        connectedAt: Date.now(),
        auth: {
          kind: "apiKey",
          apiKey: trimmed,
          viewerName: me.name,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      setAccount("linear", next);
      onConnected();
      setApiKey("");
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
          <DialogTitle className="text-xl">{t("linear.apiKeyDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("linear.apiKeyDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="linear-api-key" className="text-xs text-muted-foreground">
                {t("linear.apiKeyLabel")}
              </label>
              <a
                href="https://linear.app/settings/account/security"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input
              id="linear-api-key"
              placeholder={t("linear.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

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

function LinearSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.linear);
  if (!account) return null;
  const kindLabel = account.auth.kind === "oauth" ? t("linear.auth.kind.oauth") : t("linear.auth.kind.apiKey");
  const name = account.auth.viewerName || t("linear.viewerLogin");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{name}</span>
            <span className="truncate text-sm text-muted-foreground">{account.auth.viewerEmail || "linear.app"}</span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
