import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
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
  GithubAccount,
  GithubMyself,
  GithubOAuthAuth,
} from "@/types/github";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { LabelCombobox } from "@/sidepanel/tabs/githubFields/LabelCombobox";
import { RepoCombobox, type RepoValue } from "@/sidepanel/tabs/githubFields/RepoCombobox";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";

export function GithubConnectedBody() {
  return (
    <>
      <GithubSummary />
      <DefaultRepoField />
      <DefaultIssueSettingsFields />
    </>
  );
}

export function GithubConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [patOpen, setPatOpen] = useState(false);

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
          <Github className="h-4 w-4 dark:invert" color="default" />
          {connected
            ? t("platform.connected")
            : t("platform.connectPlatform", { platform: t("platform.tab.github") })}
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={t("platform.tab.github")}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t("github.patButton")}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setPatOpen(true)}
      />
      <PatDialog open={patOpen} onOpenChange={setPatOpen} onConnected={onConnected} />
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
              : { ...account.defaults, owner: undefined, repo: undefined, label: undefined, assignee: undefined },
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
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
