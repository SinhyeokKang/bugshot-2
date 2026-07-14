import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiGitlab } from "@icons-pack/react-simple-icons";
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
import { requestHostPermission } from "@/sidepanel/lib/ai-provider";
import type {
  GitlabAccount,
  GitlabMyself,
  GitlabOAuthAuth,
} from "@/types/gitlab";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { AssigneeCombobox } from "@/sidepanel/tabs/gitlabFields/AssigneeCombobox";
import { LabelCombobox } from "@/sidepanel/tabs/gitlabFields/LabelCombobox";
import { ProjectCombobox, type ProjectValue } from "@/sidepanel/tabs/gitlabFields/ProjectCombobox";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";
import { normalizeInstanceUrl } from "./gitlabInstanceUrl";

const GITLAB_COM = "https://gitlab.com";

export function GitlabConnectedBody() {
  return (
    <>
      <GitlabSummary />
      <DefaultProjectField />
      <DefaultIssueSettingsFields />
    </>
  );
}

export function GitlabConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [patOpen, setPatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "gitlab.oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setConnecting(true);
    try {
      const auth = await sendBg<GitlabOAuthAuth>({ type: "gitlab.startOAuth" });
      const next: GitlabAccount = {
        platform: "gitlab",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      };
      setAccount("gitlab", next);
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
          <SiGitlab className="h-4 w-4" color="default" />
          {connected
            ? t("platform.connected", { platform: t("platform.tab.gitlab") })
            : t("platform.connectPlatform", { platform: t("platform.tab.gitlab") })}
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={t("platform.tab.gitlab")}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t("gitlab.patButton")}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setPatOpen(true)}
      />
      <PatDialog open={patOpen} onOpenChange={setPatOpen} onConnected={onConnected} />
    </>
  );
}

function DefaultProjectField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.gitlab);
  const updateGitlabAccount = useSettingsStore((s) => s.updateGitlabAccount);
  if (!account) return null;
  const value: ProjectValue | null =
    account.defaults.projectId && account.defaults.projectPath
      ? {
          projectId: account.defaults.projectId,
          projectPath: account.defaults.projectPath,
        }
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("gitlab.section.project")}</label>
      <ProjectCombobox
        value={value}
        onChange={(next) =>
          // label·assignee는 project 하위 값이라 project가 바뀌면 함께 비운다.
          updateGitlabAccount({
            defaults: {
              ...account.defaults,
              projectId: next?.projectId,
              projectPath: next?.projectPath,
              label: undefined,
              assigneeId: undefined,
              assigneeName: undefined,
            },
          })
        }
      />
    </div>
  );
}

function DefaultIssueSettingsFields() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.gitlab);
  const updateGitlabAccount = useSettingsStore((s) => s.updateGitlabAccount);
  if (!account) return null;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("gitlab.field.labels")}</label>
        <LabelCombobox
          projectId={account.defaults.projectId}
          value={account.defaults.label}
          onChange={(next) =>
            updateGitlabAccount({
              defaults: { ...account.defaults, label: next },
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("gitlab.field.assignee")}</label>
        <AssigneeCombobox
          projectId={account.defaults.projectId}
          value={
            account.defaults.assigneeId && account.defaults.assigneeName
              ? { id: account.defaults.assigneeId, username: account.defaults.assigneeName }
              : null
          }
          onChange={(next) =>
            updateGitlabAccount({
              defaults: {
                ...account.defaults,
                assigneeId: next?.id,
                assigneeName: next?.username,
              },
            })
          }
        />
      </div>
    </>
  );
}

function tokenSettingsHref(instanceUrl: string): string {
  try {
    const base = normalizeInstanceUrl(instanceUrl);
    return `${base}/-/user_settings/personal_access_tokens`;
  } catch {
    return `${GITLAB_COM}/-/user_settings/personal_access_tokens`;
  }
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
  const [instanceUrl, setInstanceUrl] = useState(GITLAB_COM);
  const [pat, setPat] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed = pat.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    setValidating(true);
    try {
      let baseUrl: string;
      try {
        baseUrl = normalizeInstanceUrl(instanceUrl);
      } catch {
        toast.error(t("gitlab.instanceUrl.invalid"));
        return;
      }
      if (baseUrl !== GITLAB_COM) {
        const granted = await requestHostPermission(baseUrl);
        if (!granted) {
          toast.error(t("gitlab.selfManaged.permissionDenied"));
          return;
        }
      }
      const me = await sendBg<GitlabMyself>({
        type: "gitlab.testPat",
        pat: trimmed,
        baseUrl,
      });
      const next: GitlabAccount = {
        platform: "gitlab",
        connectedAt: Date.now(),
        auth: {
          kind: "pat",
          pat: trimmed,
          baseUrl,
          viewerUsername: me.username,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      setAccount("gitlab", next);
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
          <DialogTitle className="text-xl">{t("gitlab.patDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("gitlab.patDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gitlab-instance" className="text-xs text-muted-foreground">
              {t("gitlab.instanceUrl.label")}
            </label>
            <Input
              id="gitlab-instance"
              placeholder={t("gitlab.instanceUrl.placeholder")}
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="gitlab-pat" className="text-xs text-muted-foreground">
                {t("gitlab.patLabel")}
              </label>
              <a
                href={tokenSettingsHref(instanceUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input
              id="gitlab-pat"
              placeholder={t("gitlab.patPlaceholder")}
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

function GitlabSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.gitlab);
  if (!account) return null;
  const kindLabel =
    account.auth.kind === "oauth"
      ? t("gitlab.auth.kind.oauth")
      : t("gitlab.auth.kind.pat");
  const username = account.auth.viewerUsername || t("gitlab.viewerUsername");
  let host = account.auth.baseUrl;
  try {
    host = new URL(account.auth.baseUrl).hostname;
  } catch {
    /* keep raw */
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{username}</span>
            <span className="truncate text-sm text-muted-foreground">{account.auth.viewerEmail || host}</span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
