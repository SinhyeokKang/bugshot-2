import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, Github, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings-store";
import type {
  GithubAccount,
  GithubMyself,
  GithubOAuthAuth,
} from "@/types/github";
import { sendBg } from "@/types/messages";
import { PageFooter, PageScroll, Section } from "../../components/Section";

const DISMISS_PATTERNS = /cancel|취소|not approve|not authorize/i;

export function GithubConnectForm() {
  const githubAccount = useSettingsStore((s) => s.accounts.github);
  const connected = !!githubAccount;

  if (!connected) {
    return (
      <PageScroll>
        <Section>
          <GithubOnboarding />
        </Section>
      </PageScroll>
    );
  }

  return (
    <>
      <PageScroll>
        <Section>
          <GithubSummary />
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

function GithubOnboarding() {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);

  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const [pat, setPat] = useState("");
  const [patSaving, setPatSaving] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "github.oauth.available" })
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
      const auth = await sendBg<GithubOAuthAuth>({ type: "github.startOAuth" });
      const next: GithubAccount = {
        platform: "github",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      };
      setAccount("github", next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!DISMISS_PATTERNS.test(msg)) setOauthError(msg);
    } finally {
      setConnecting(false);
    }
  }

  async function savePat() {
    const trimmed = pat.trim();
    if (!trimmed) return;
    setPatError(null);
    setPatSaving(true);
    try {
      const me = await sendBg<GithubMyself>({
        type: "github.testPat",
        pat: trimmed,
      });
      const next: GithubAccount = {
        platform: "github",
        connectedAt: Date.now(),
        auth: { kind: "pat", pat: trimmed, viewerLogin: me.login },
        defaults: {},
      };
      setAccount("github", next);
      setPat("");
    } catch (err) {
      setPatError(err instanceof Error ? err.message : String(err));
    } finally {
      setPatSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 px-4 py-2 text-center">
        <div className="rounded-full bg-muted p-3">
          <Github className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-[18px] font-semibold">GitHub</h3>

        <Button
          onClick={() => void startOAuth()}
          disabled={connecting || oauthAvailable === false}
          className="relative gap-2"
        >
          {connecting && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          )}
          <span className={connecting ? "opacity-0 inline-flex items-center gap-2" : "inline-flex items-center gap-2"}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t("github.oauthLogin")}
          </span>
        </Button>

        {oauthAvailable === false ? (
          <p className="text-xs text-muted-foreground">
            {t("github.oauth.notConfigured")}
          </p>
        ) : null}

        {oauthError ? (
          <Alert variant="destructive" className="text-xs">
            <AlertDescription>{oauthError}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="border-t border-border" />

      <div className="flex flex-col gap-2 px-1">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{t("github.patSection.title")}</h4>
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("settings.getToken")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">{t("github.patSection.help")}</p>

        <div className="mt-1 flex gap-2">
          <Input
            placeholder={t("github.patPlaceholder")}
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={patSaving}
          />
          <Button
            onClick={() => void savePat()}
            disabled={!pat.trim() || patSaving}
            className="relative shrink-0"
          >
            {patSaving && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={patSaving ? "opacity-0" : undefined}>
              {t("github.patSave")}
            </span>
          </Button>
        </div>

        {patError ? (
          <Alert variant="destructive" className="text-xs">
            <AlertDescription>{patError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

function GithubSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.github);
  if (!account) return null;
  const kindLabel = account.auth.kind === "oauth" ? "OAuth" : "PAT";
  const login = account.auth.viewerLogin || t("github.viewerLogin");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{login}</span>
            <span className="truncate text-sm text-muted-foreground">github.com</span>
          </div>
          <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
            <CircleCheck className="h-3 w-3" />
            {kindLabel}
          </Badge>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t("settings.connected")}</p>
    </div>
  );
}

function DisconnectButton() {
  const t = useT();
  const removeAccount = useSettingsStore((s) => s.removeAccount);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          {t("platform.disconnect")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings.disconnect.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings.disconnect.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => removeAccount("github")}>
            {t("settings.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
