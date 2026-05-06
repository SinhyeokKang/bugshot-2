import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { SiJirasoftware as Jira } from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
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
import { PageFooter, PageScroll, Section } from "../../components/Section";
import { IssueTypeCombobox } from "../IssueTypeCombobox";
import { ProjectCombobox } from "../ProjectCombobox";

export function JiraConnectForm() {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const connected = !!jiraAccount;

  if (!connected) {
    return (
      <>
        <JiraOnboarding />
        <SetupDialog />
      </>
    );
  }

  return (
    <>
      <PageScroll>
        <Section title={t("settings.jiraConnection")}>
          <JiraSummary />
        </Section>

        <Section title={t("settings.jiraSettings")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">{t("settings.project")}</label>
              <ProjectCombobox />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">{t("settings.defaultIssueType")}</label>
              <IssueTypeCombobox />
            </div>
          </div>
        </Section>
      </PageScroll>

      <PageFooter>
        <div className="flex justify-between">
          <DisconnectButton />
        </div>
      </PageFooter>

      <SetupDialog />
    </>
  );
}

/* ── Onboarding (empty state) ────────────────────────── */

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

function JiraOnboarding() {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);

  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<OAuthClassified | null>(null);
  const [candidate, setCandidate] = useState<OAuthStartResultMsg | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setError(null);
    setConnecting(true);
    try {
      const result = await sendBg<OAuthStartResultMsg>({ type: "oauth.start" });
      if (result.sites.length === 0) {
        throw new NoJiraSitesError(t("settings.noJiraSites"));
      }
      if (result.sites.length === 1) {
        await finalize(result, result.sites[0]);
      } else {
        setCandidate(result);
      }
    } catch (err) {
      setError(classifyOAuthClassified(err));
    } finally {
      setConnecting(false);
    }
  }

  async function finalize(result: OAuthStartResultMsg, site: JiraSite) {
    setError(null);
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
      setCandidate(null);
    } catch (err) {
      setError(classifyOAuthClassified(err));
    } finally {
      setConnecting(false);
    }
  }

  if (candidate) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="flex w-full max-w-[260px] flex-col gap-2">
          <p className="mb-1 text-center text-sm font-medium">
            {t("settings.selectSite")}
          </p>
          {candidate.sites.map((site) => (
            <Button
              key={site.id}
              variant="outline"
              disabled={connecting}
              onClick={() => void finalize(candidate, site)}
              className="h-auto justify-start gap-2 px-3 py-2 text-xs"
            >
              {site.avatarUrl ? (
                <img
                  src={site.avatarUrl}
                  alt=""
                  className="h-6 w-6 rounded"
                />
              ) : null}
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{site.name}</span>
                <span className="truncate text-muted-foreground">
                  {site.url}
                </span>
              </div>
            </Button>
          ))}
          <OAuthClassifiedBanner error={error} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <Jira className="h-6 w-6" color="default" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("settings.onboarding.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.onboarding.body")}
        </p>

        <div className="mt-5 flex gap-2">
          {oauthAvailable !== false ? (
            <Button
              onClick={() => void startOAuth()}
              disabled={connecting || oauthAvailable === null}
              className="relative"
            >
              {connecting && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              )}
              <span className={`inline-flex items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                {t("settings.atlassianLogin")}
              </span>
            </Button>
          ) : null}

          <Button
            variant="outline"
            onClick={() => setApiKeyOpen(true)}
            disabled={connecting}
            className="gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            API Token
          </Button>
        </div>

        <OAuthClassifiedBanner error={error} />
      </div>

      <ApiKeyDialog open={apiKeyOpen} onOpenChange={setApiKeyOpen} />
    </>
  );
}

function ApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
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
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("settings.apiKeyDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.apiKeyDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="jira-baseUrl" className="text-xs text-muted-foreground">
              {t("settings.workspaceUrl")}
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
              {t("settings.email")}
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
                {t("settings.apiToken")}
              </label>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("settings.getToken")}
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

          {error ? (
            <Alert variant="destructive" className="text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
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

function OAuthClassifiedBanner({ error }: { error: OAuthClassified | null }) {
  const t = useT();
  if (!error) return null;
  if (error.kind === "noJira") {
    return (
      <Alert variant="destructive" className="text-xs">
        <div className="flex items-start justify-between gap-2">
          <div>
            <AlertTitle className="text-xs">
              {t("settings.oauthError.noJira.title")}
            </AlertTitle>
            <AlertDescription className="text-xs text-destructive/80">
              {t("settings.oauthError.noJira.body")}
            </AlertDescription>
          </div>
          <a
            href="https://id.atlassian.com/logout"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-destructive/70 underline underline-offset-2 transition-colors hover:text-destructive"
          >
            {t("settings.switchAccount")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" className="text-xs">
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
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
          <DialogTitle className="text-xl">{t("settings.projectDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.projectDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            {t("settings.projectDialog.label")}
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
  const kindLabel = auth.kind === "oauth" ? "OAuth" : "API Token";

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{host}</span>
            <span className="truncate text-sm text-muted-foreground">{auth.email}</span>
          </div>
          <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
            <CircleCheck className="h-3 w-3" />
            {kindLabel}
          </Badge>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {t("platform.connected", { platform: t("platform.tab.jira") })}
      </p>
    </div>
  );
}

function DisconnectButton() {
  const t = useT();
  const removeAccount = useSettingsStore((s) => s.removeAccount);
  const platform = t("platform.tab.jira");

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          {t("platform.disconnect")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("platform.disconnect.title", { platform })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("platform.disconnect.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => removeAccount("jira")}
          >
            {t("platform.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
