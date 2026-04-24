import { useEffect, useState } from "react";
import {
  CircleCheck,
  ExternalLink,
  KeyRound,
  Link,
  Loader2,
} from "lucide-react";
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
  type JiraConfig,
  jiraHostLabel,
} from "@/store/settings-store";
import type {
  JiraApiKeyAuth,
  JiraAuth,
  JiraMyself,
  JiraOAuthAuth,
  JiraSite,
} from "@/types/jira";
import { sendBg, type OAuthStartResultMsg } from "@/types/messages";
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";
import { IssueTypeCombobox } from "./IssueTypeCombobox";
import { ProjectCombobox } from "./ProjectCombobox";

export function SettingsTab() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const connected = !!jiraConfig;

  if (!connected) {
    return (
      <PageShell>
        <JiraOnboarding />
        <SetupDialog />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageScroll>
        <Section title="Jira 연결">
          <JiraSummary />
        </Section>

        <Section title="프로젝트">
          <ProjectCombobox />
        </Section>

        <Section title="이슈 설정">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">기본 이슈 타입</label>
              <IssueTypeCombobox />
            </div>

            <TitlePrefixField />
          </div>
        </Section>
      </PageScroll>

      <PageFooter>
        <div className="flex justify-end">
          <DisconnectButton />
        </div>
      </PageFooter>

      <SetupDialog />
    </PageShell>
  );
}

/* ── Onboarding (empty state) ────────────────────────── */

type OAuthError = { kind: "noJira" } | { kind: "general"; message: string };

const DISMISS_PATTERNS = /cancel|취소|not approve/i;
const NO_JIRA_PATTERNS = /could not be loaded|Jira 사이트가 없/i;

function classifyOAuthError(err: unknown): OAuthError | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (DISMISS_PATTERNS.test(msg)) return null;
  if (NO_JIRA_PATTERNS.test(msg)) return { kind: "noJira" };
  return { kind: "general", message: msg };
}

function JiraOnboarding() {
  const setJiraConfig = useSettingsStore((s) => s.setJiraConfig);

  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<OAuthError | null>(null);
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
        throw new Error("접근 가능한 Jira 사이트가 없습니다.");
      }
      if (result.sites.length === 1) {
        await finalize(result, result.sites[0]);
      } else {
        setCandidate(result);
      }
    } catch (err) {
      setError(classifyOAuthError(err));
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
      const next: JiraConfig = {
        auth: { ...auth, email: me.emailAddress },
      };
      setJiraConfig(next);
      setCandidate(null);
    } catch (err) {
      setError(classifyOAuthError(err));
    } finally {
      setConnecting(false);
    }
  }

  // 사이트 선택 화면
  if (candidate) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="flex w-full max-w-[260px] flex-col gap-2">
          <p className="mb-1 text-center text-sm font-medium">
            연결할 사이트를 선택하세요
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
          <OAuthErrorBanner error={error} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <Link className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-[18px] font-semibold">Jira 연결</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Atlassian 계정 또는 API Token을 이용해 Jira와 연동해 주세요.
        </p>

        <div className="mt-5 flex gap-2">
          {oauthAvailable !== false ? (
            <Button
              onClick={() => void startOAuth()}
              disabled={connecting || oauthAvailable === null}
            >
              {connecting ? (
                <>
                  <Loader2 className="animate-spin" />
                  연결 중...
                </>
              ) : (
                <>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Atlassian 로그인
                </>
              )}
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

        <div className="mt-3 w-full max-w-[260px]">
          <OAuthErrorBanner error={error} />
        </div>
      </div>

      <ApiKeyDialog open={apiKeyOpen} onOpenChange={setApiKeyOpen} />
    </>
  );
}

/* ── API Key Dialog ──────────────────────────────────── */

function ApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const setJiraConfig = useSettingsStore((s) => s.setJiraConfig);
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
      const next: JiraConfig = { auth: trimmed };
      setJiraConfig(next);
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
          <DialogTitle className="text-xl">API Token 인증</DialogTitle>
          <DialogDescription>
            Jira 워크스페이스 URL과 인증 정보를 입력하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="jira-baseUrl" className="text-xs text-muted-foreground">
              워크스페이스 URL
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
              이메일
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
                API 토큰
              </label>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                발급 페이지
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleValidate} disabled={!canValidate}>
            {validating ? (
              <>
                <Loader2 className="animate-spin" />
                검증 중...
              </>
            ) : (
              "검증"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── OAuth Error Banner ──────────────────────────────── */

function OAuthErrorBanner({ error }: { error: OAuthError | null }) {
  if (!error) return null;
  if (error.kind === "noJira") {
    return (
      <Alert variant="destructive" className="text-xs">
        <div className="flex items-start justify-between gap-2">
          <div>
            <AlertTitle className="text-xs">
              Jira가 존재하지 않는 계정입니다.
            </AlertTitle>
            <AlertDescription className="text-xs text-destructive/80">
              계정을 변경하여 재시도해주세요.
            </AlertDescription>
          </div>
          <a
            href="https://id.atlassian.com/logout"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-destructive/70 underline underline-offset-2 transition-colors hover:text-destructive"
          >
            계정 전환
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

/* ── Setup Dialog (project selection after auth) ─────── */

function SetupDialog() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const clearJiraConfig = useSettingsStore((s) => s.clearJiraConfig);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (jiraConfig && !jiraConfig.projectKey) {
      setOpen(true);
    }
  }, [jiraConfig]);

  function handleCancel() {
    setOpen(false);
    clearJiraConfig();
  }

  function handleComplete() {
    if (!jiraConfig?.projectKey) return;
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
          <DialogTitle className="text-xl">프로젝트 선택</DialogTitle>
          <DialogDescription>
            이슈를 생성할 프로젝트를 선택하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            프로젝트
          </label>
          <ProjectCombobox />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            취소
          </Button>
          <Button
            disabled={!jiraConfig?.projectKey}
            onClick={handleComplete}
          >
            완료
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Connected state components ──────────────────────── */

function TitlePrefixField() {
  const titlePrefix = useSettingsStore(
    (s) => s.jiraConfig?.titlePrefix ?? "",
  );
  const updateJiraConfig = useSettingsStore((s) => s.updateJiraConfig);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="jira-title-prefix" className="text-xs text-muted-foreground">제목 Prefix</label>
      <Input
        id="jira-title-prefix"
        placeholder="[QA] "
        value={titlePrefix}
        onChange={(e) => updateJiraConfig({ titlePrefix: e.target.value })}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="text-xs text-muted-foreground">
        이슈 제목 앞에 자동으로 붙습니다. 비워두면 사용하지 않습니다.
      </p>
    </div>
  );
}

function JiraSummary() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  if (!jiraConfig) return null;

  const auth = jiraConfig.auth;
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
        Jira에 정상적으로 연결되었습니다.
      </p>
    </div>
  );
}

function DisconnectButton() {
  const clearJiraConfig = useSettingsStore((s) => s.clearJiraConfig);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="lg" variant="outline">
          Jira 연결 해제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Jira 연결을 해제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            인증 정보와 프로젝트 설정이 모두 초기화됩니다. 다시 연결하려면 재인증이 필요합니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => clearJiraConfig()}
          >
            연결 해제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
