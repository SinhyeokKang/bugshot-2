import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
import { toast } from "sonner";
import { useT } from "@/i18n";
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
  GithubAccount,
  GithubMyself,
  GithubOAuthAuth,
} from "@/types/github";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { PageScroll, Section } from "@/sidepanel/components/Section";
import { LabelCombobox } from "@/sidepanel/tabs/githubFields/LabelCombobox";
import { RepoCombobox, type RepoValue } from "@/sidepanel/tabs/githubFields/RepoCombobox";

export function GithubConnectForm() {
  const t = useT();
  const githubAccount = useSettingsStore((s) => s.accounts.github);
  const connected = !!githubAccount;

  if (!connected) {
    return <GithubOnboarding />;
  }

  return (
    <>
      <PageScroll>
        <Section title={t("github.section.connection")}>
          <GithubSummary />
        </Section>
        <Section title={t("common.settings")}>
          <div className="flex flex-col gap-3">
            <DefaultRepoField />
            <DefaultIssueSettingsFields />
          </div>
        </Section>
      </PageScroll>
    </>
  );
}

function DefaultRepoField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.github);
  const updateGithubAccount = useSettingsStore((s) => s.updateGithubAccount);
  if (!account) return null;
  const value: RepoValue | null =
    account.defaults.owner && account.defaults.repo
      ? { owner: account.defaults.owner, repo: account.defaults.repo }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("github.section.repo")}</label>
      <RepoCombobox
        value={value}
        onChange={(next) =>
          updateGithubAccount({
            defaults: next
              ? { ...account.defaults, owner: next.owner, repo: next.repo }
              : { ...account.defaults, owner: undefined, repo: undefined, label: undefined, assignees: [] },
          })
        }
      />
    </div>
  );
}

function DefaultIssueSettingsFields() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.github);
  const updateGithubAccount = useSettingsStore((s) => s.updateGithubAccount);
  if (!account) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("github.field.labels")}</label>
      <LabelCombobox
        owner={account.defaults.owner}
        repo={account.defaults.repo}
        value={account.defaults.label}
        onChange={(next) =>
          updateGithubAccount({
            defaults: { ...account.defaults, label: next },
          })
        }
      />
    </div>
  );
}

function GithubOnboarding() {
  const t = useT();
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [patOpen, setPatOpen] = useState(false);

  const setAccount = useSettingsStore((s) => s.setAccount);

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
      if (!isOAuthCancelled(err)) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <Github className="h-6 w-6 dark:invert" color="default" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("github.onboarding.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("github.onboarding.body")}
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
                {t("github.oauthLogin")}
              </span>
            </Button>
          ) : null}

          <Button
            variant="outline"
            onClick={() => setPatOpen(true)}
            disabled={connecting}
            className="gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t("github.patButton")}
          </Button>
        </div>

        {oauthAvailable === false ? (
          <p className="text-xs text-muted-foreground">
            {t("github.oauth.notConfigured")}
          </p>
        ) : null}
      </div>

      <PatDialog open={patOpen} onOpenChange={setPatOpen} />
    </>
  );
}

function PatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
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
      const me = await sendBg<GithubMyself>({
        type: "github.testPat",
        pat: trimmed,
      });
      const next: GithubAccount = {
        platform: "github",
        connectedAt: Date.now(),
        auth: {
          kind: "pat",
          pat: trimmed,
          viewerLogin: me.login,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      setAccount("github", next);
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
          <DialogTitle className="text-xl">{t("github.patDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("github.patDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="github-pat" className="text-xs text-muted-foreground">
                {t("github.patLabel")}
              </label>
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input
              id="github-pat"
              placeholder={t("github.patPlaceholder")}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
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

function GithubSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.github);
  if (!account) return null;
  const kindLabel = account.auth.kind === "oauth" ? t("github.auth.kind.oauth") : t("github.auth.kind.pat");
  const login = account.auth.viewerLogin || t("github.viewerLogin");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{login}</span>
            <span className="truncate text-sm text-muted-foreground">{account.auth.viewerEmail || "github.com"}</span>
          </div>
          <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
            <CircleCheck className="h-3 w-3" />
            {kindLabel}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

