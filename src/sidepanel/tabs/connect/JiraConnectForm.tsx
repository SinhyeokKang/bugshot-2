import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiJirasoftware as Jira } from "@icons-pack/react-simple-icons";
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
import {
  useSettingsStore,
  type JiraAccount,
  jiraHostLabel,
} from "@/store/settings-store";
import type {
  JiraApiKeyAuth,
  JiraAuth,
  JiraMyself,
  JiraOAuthAuth,
  JiraSite,
} from "@/types/jira";
import { isOAuthCancelled, sendBg, type OAuthStartResultMsg } from "@/types/messages";
import { IssueTypeCombobox } from "@/sidepanel/tabs/IssueTypeCombobox";
import { ProjectCombobox } from "@/sidepanel/tabs/ProjectCombobox";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";

export function JiraConnectedBody() {
  const t = useT();
  return (
    <>
      <JiraSummary />
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("jira.project")}</label>
        <ProjectCombobox />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("jira.defaultIssueType")}</label>
        <IssueTypeCombobox />
      </div>
      <SetupDialog />
    </>
  );
}

type OAuthClassified = { kind: "noJira" } | { kind: "general"; message: string };

class NoJiraSitesError extends Error {
  constructor(message: string) { super(message); this.name = "NoJiraSitesError"; }
}

function classifyOAuthClassified(err: unknown): OAuthClassified | null {
  if (err instanceof NoJiraSitesError) return { kind: "noJira" };
  if (isOAuthCancelled(err)) return null;
  const msg = err instanceof Error ? err.message : String(err);
  return { kind: "general", message: msg };
}

export function JiraConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);

  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [candidate, setCandidate] = useState<OAuthStartResultMsg | null>(null);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  function showOAuthError(err: unknown) {
    const classified = classifyOAuthClassified(err);
    if (!classified) return;
    if (classified.kind === "noJira") {
      toast.error(t("jira.oauthError.noJira.title"), {
        description: t("jira.oauthError.noJira.body"),
        action: {
          label: t("jira.switchAccount"),
          onClick: () => window.open("https://id.atlassian.com/logout", "_blank"),
        },
      });
    } else {
      toast.error(classified.message);
    }
  }

  async function startOAuth() {
    setConnecting(true);
    try {
      const result = await sendBg<OAuthStartResultMsg>({ type: "oauth.start" });
      if (result.sites.length === 0) {
        throw new NoJiraSitesError(t("jira.noJiraSites"));
      }
      if (result.sites.length === 1) {
        await finalize(result, result.sites[0]);
      } else {
        setCandidate(result);
      }
    } catch (err) {
      showOAuthError(err);
    } finally {
      setConnecting(false);
    }
  }

  async function finalize(result: OAuthStartResultMsg, site: JiraSite) {
    setConnecting(true);
    try {
      const auth: JiraOAuthAuth = {
        kind: "oauth",
        cloudId: site.id,
        siteUrl: site.url,
        email: "",
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      };
      const me = await sendBg<JiraMyself>({
        type: "jira.myself",
        config: auth,
      });
      const next: JiraAccount = {
        platform: "jira",
        connectedAt: Date.now(),
        auth: { ...auth, email: me.emailAddress },
      };
      setAccount("jira", next);
      onConnected();
      setCandidate(null);
    } catch (err) {
      showOAuthError(err);
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
          <Jira className="h-4 w-4" color="default" />
          {t("platform.connectPlatform", { platform: t("platform.tab.jira") })}
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={t("platform.tab.jira")}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t("jira.apiTokenButton")}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setApiKeyOpen(true)}
      />
      <ApiKeyDialog open={apiKeyOpen} onOpenChange={setApiKeyOpen} onConnected={onConnected} />
      <JiraSiteDialog
        open={!!candidate}
        onOpenChange={(v) => {
          if (!v) setCandidate(null);
        }}
        sites={candidate?.sites ?? []}
        connecting={connecting}
        onSelect={(site) => {
          if (candidate) void finalize(candidate, site);
        }}
      />
    </>
  );
}

function JiraSiteDialog({
  open,
  onOpenChange,
  sites,
  connecting,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sites: JiraSite[];
  connecting: boolean;
  onSelect: (site: JiraSite) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("jira.selectSite")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {sites.map((site) => (
            <Button
              key={site.id}
              variant="outline"
              disabled={connecting}
              onClick={() => onSelect(site)}
              className="h-auto justify-start gap-2 px-3 py-2 text-xs"
            >
              {site.avatarUrl ? (
                <img src={site.avatarUrl} alt="" className="h-6 w-6 rounded" />
              ) : null}
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{site.name}</span>
                <span className="truncate text-muted-foreground">{site.url}</span>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
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
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed: JiraApiKeyAuth = {
    kind: "apiKey",
    baseUrl: baseUrl.trim(),
    email: email.trim(),
    apiToken: apiToken.trim(),
  };
  const canValidate =
    !!trimmed.baseUrl && !!trimmed.email && !!trimmed.apiToken && !validating;

  async function handleValidate() {
    setValidating(true);
    try {
      await sendBg<JiraMyself>({
        type: "jira.myself",
        config: trimmed as JiraAuth,
      });
      const next: JiraAccount = {
        platform: "jira",
        connectedAt: Date.now(),
        auth: trimmed,
      };
      setAccount("jira", next);
      onConnected();
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
          <DialogTitle className="text-xl">{t("jira.apiKeyDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("jira.apiKeyDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="jira-baseUrl" className="text-xs text-muted-foreground">
              {t("jira.workspaceUrl")}
            </label>
            <Input
              id="jira-baseUrl"
              placeholder="https://your-workspace.atlassian.net"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="jira-email" className="text-xs text-muted-foreground">
              {t("jira.email")}
            </label>
            <Input
              id="jira-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="jira-token" className="text-xs text-muted-foreground">
                {t("jira.apiToken")}
              </label>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input
              id="jira-token"
              placeholder="atl_xxx..."
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
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

function SetupDialog() {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const removeAccount = useSettingsStore((s) => s.removeAccount);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (jiraAccount && !jiraAccount.projectKey) {
      setOpen(true);
    }
  }, [jiraAccount]);

  function handleCancel() {
    setOpen(false);
    removeAccount("jira");
  }

  function handleComplete() {
    if (!jiraAccount?.projectKey) return;
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
      }}
    >
      <DialogContent
        className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{t("jira.projectDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("jira.projectDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            {t("jira.projectDialog.label")}
          </label>
          <ProjectCombobox />
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={handleCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!jiraAccount?.projectKey}
            onClick={handleComplete}
          >
            {t("common.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JiraSummary() {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  if (!jiraAccount) return null;

  const auth = jiraAccount.auth;
  const host = jiraHostLabel(auth);
  const kindLabel = auth.kind === "oauth" ? t("jira.auth.kind.oauth") : t("jira.auth.kind.apiToken");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{host}</span>
            <span className="truncate text-sm text-muted-foreground">{auth.email}</span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
