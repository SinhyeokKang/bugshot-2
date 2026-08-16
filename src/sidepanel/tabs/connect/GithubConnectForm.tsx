import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { ConnectedBadge } from "@/sidepanel/components/ConnectedBadge";
import { FieldRow } from "@/sidepanel/components/FieldRow";
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
import { sendBg } from "@/lib/bg-client";
import { AssigneeCombobox } from "@/sidepanel/tabs/githubFields/AssigneeCombobox";
import { LabelCombobox } from "@/sidepanel/tabs/githubFields/LabelCombobox";
import { RepoCombobox, type RepoValue } from "@/sidepanel/tabs/githubFields/RepoCombobox";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { PlatformConnectFlow } from "./PlatformConnectFlow";

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
  return (
    <PlatformConnectFlow
      connected={connected}
      onConnected={onConnected}
      platform="github"
      icon={<Github className="h-4 w-4 dark:invert" color="default" />}
      tokenLabelKey="github.patButton"
      availableRequest={{ type: "github.oauth.available" }}
      startOAuthRequest={{ type: "github.startOAuth" }}
      buildAccount={(auth: GithubOAuthAuth): GithubAccount => ({
        platform: "github",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      })}
      renderTokenDialog={({ open, onOpenChange }) => (
        <PatDialog open={open} onOpenChange={onOpenChange} onConnected={onConnected} />
      )}
    />
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
    <FieldRow label={t("github.section.repo")}>
      <RepoCombobox
        value={value}
        onChange={(next) =>
          // label·assignee는 repo 하위 값이라 repo가 바뀌면(교체·해제 모두) 함께 비운다.
          updateGithubAccount({
            defaults: {
              ...account.defaults,
              owner: next?.owner,
              repo: next?.repo,
              label: undefined,
              assignee: undefined,
            },
          })
        }
      />
    </FieldRow>
  );
}

function DefaultIssueSettingsFields() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.github);
  const updateGithubAccount = useSettingsStore((s) => s.updateGithubAccount);
  if (!account) return null;
  return (
    <>
      <FieldRow label={t("github.field.labels")}>
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
      </FieldRow>
      <FieldRow label={t("github.field.assignee")}>
        <AssigneeCombobox
          owner={account.defaults.owner}
          repo={account.defaults.repo}
          value={account.defaults.assignee}
          onChange={(next) =>
            updateGithubAccount({
              defaults: { ...account.defaults, assignee: next },
            })
          }
        />
      </FieldRow>
    </>
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
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("github.patDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("github.patDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FieldRow
            label={t("github.patLabel")}
            htmlFor="github-pat"
            labelAction={
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            <Input
              id="github-pat"
              placeholder={t("github.patPlaceholder")}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </FieldRow>

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
