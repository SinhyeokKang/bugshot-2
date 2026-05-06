import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { SiLinear } from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useSettingsStore } from "@/store/settings-store";
import type {
  LinearAccount,
  LinearMyself,
  LinearOAuthAuth,
} from "@/types/linear";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { PageFooter, PageScroll, Section } from "../../components/Section";
import { TeamCombobox, type TeamValue } from "../linearFields/TeamCombobox";
import { ProjectCombobox } from "../linearFields/ProjectCombobox";
import { LabelCombobox } from "../linearFields/LabelCombobox";

export function LinearConnectForm() {
  const t = useT();
  const linearAccount = useSettingsStore((s) => s.accounts.linear);
  const connected = !!linearAccount;

  if (!connected) {
    return <LinearOnboarding />;
  }

  return (
    <>
      <PageScroll>
        <Section title={t("linear.section.connection")}>
          <LinearSummary />
        </Section>
        <Section title={t("linear.section.settings")}>
          <div className="flex flex-col gap-3">
            <DefaultTeamField />
            <DefaultIssueSettingsFields />
          </div>
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex justify-between">
          <DisconnectButton />
        </div>
      </PageFooter>
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

function LinearOnboarding() {
  const t = useT();
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);

  const setAccount = useSettingsStore((s) => s.setAccount);

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
    setOauthError(null);
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
    } catch (err) {
      if (!isOAuthCancelled(err)) {
        setOauthError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <SiLinear className="h-6 w-6" color="default" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("linear.onboarding.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("linear.onboarding.body")}
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
                {t("linear.oauthLogin")}
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
            {t("linear.apiKeyButton")}
          </Button>
        </div>

        {oauthAvailable === false ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("linear.oauth.notConfigured")}
          </p>
        ) : null}
        {oauthError ? (
          <Alert variant="destructive" className="mt-3 text-xs">
            <AlertDescription>{oauthError}</AlertDescription>
          </Alert>
        ) : null}
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
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const trimmed = apiKey.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    setError(null);
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
      setApiKey("");
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
                {t("settings.getToken")}
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

function LinearSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.linear);
  if (!account) return null;
  const kindLabel = account.auth.kind === "oauth" ? "OAuth" : "API Key";
  const name = account.auth.viewerName || t("linear.viewerLogin");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{name}</span>
            <span className="truncate text-sm text-muted-foreground">{account.auth.viewerEmail || "linear.app"}</span>
          </div>
          <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
            <CircleCheck className="h-3 w-3" />
            {kindLabel}
          </Badge>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {t("platform.connected", { platform: t("platform.tab.linear") })}
      </p>
    </div>
  );
}

function DisconnectButton() {
  const t = useT();
  const removeAccount = useSettingsStore((s) => s.removeAccount);
  const platform = t("platform.tab.linear");

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
          <AlertDialogAction onClick={() => removeAccount("linear")}>
            {t("platform.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
