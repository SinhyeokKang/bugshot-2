import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { PageScroll, PageShell, Section } from "../components/Section";
import { IssueTypeCombobox } from "./IssueTypeCombobox";
import { ProjectCombobox } from "./ProjectCombobox";

type AuthKind = "oauth" | "apiKey";

export function SettingsTab() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const connected = !!jiraConfig;

  return (
    <PageShell>
      <PageScroll>
        <Section title="Jira 연결">
          {connected ? <JiraSummary /> : <JiraAuthForm />}
        </Section>

        <Section title="프로젝트">
          {connected ? (
            <ProjectCombobox />
          ) : (
            <p className="text-xs text-muted-foreground">
              Jira 연결 후 선택할 수 있습니다.
            </p>
          )}
        </Section>

        {connected ? (
          <Section title="이슈 설정">
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label>기본 이슈 타입</Label>
                <IssueTypeCombobox />
              </div>

              <TitlePrefixField />
            </div>
          </Section>
        ) : null}
      </PageScroll>
    </PageShell>
  );
}

function TitlePrefixField() {
  const titlePrefix = useSettingsStore(
    (s) => s.jiraConfig?.titlePrefix ?? "",
  );
  const updateJiraConfig = useSettingsStore((s) => s.updateJiraConfig);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="jira-title-prefix">제목 Prefix</Label>
      <Input
        id="jira-title-prefix"
        placeholder="[QA] "
        value={titlePrefix}
        onChange={(e) => updateJiraConfig({ titlePrefix: e.target.value })}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="text-[11px] text-muted-foreground">
        이슈 제목 앞에 자동으로 붙습니다. 비워두면 사용하지 않습니다.
      </p>
    </div>
  );
}

function JiraSummary() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const clearJiraConfig = useSettingsStore((s) => s.clearJiraConfig);
  if (!jiraConfig) return null;

  const auth = jiraConfig.auth;
  const host = jiraHostLabel(auth);
  const kindLabel = auth.kind === "oauth" ? "OAuth" : "API Token";

  return (
    <Card>
      <CardContent className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-foreground">{host}</span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {kindLabel}
            </Badge>
          </div>
          <span className="truncate text-muted-foreground">{auth.email}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => clearJiraConfig()}>
          재설정
        </Button>
      </CardContent>
    </Card>
  );
}

function JiraAuthForm() {
  const [kind, setKind] = useState<AuthKind>("oauth");
  return (
    <Tabs value={kind} onValueChange={(v) => setKind(v as AuthKind)}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="oauth">OAuth</TabsTrigger>
        <TabsTrigger value="apiKey">API Token</TabsTrigger>
      </TabsList>
      <TabsContent value="oauth" className="mt-3">
        <OAuthForm />
      </TabsContent>
      <TabsContent value="apiKey" className="mt-3">
        <ApiKeyForm />
      </TabsContent>
    </Tabs>
  );
}

type OAuthError = { kind: "noJira" } | { kind: "general"; message: string };

const DISMISS_PATTERNS = /cancel|취소|not approve/i;
const NO_JIRA_PATTERNS = /could not be loaded|Jira 사이트가 없/i;

function classifyOAuthError(err: unknown): OAuthError | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (DISMISS_PATTERNS.test(msg)) return null;
  if (NO_JIRA_PATTERNS.test(msg)) return { kind: "noJira" };
  return { kind: "general", message: msg };
}

function OAuthForm() {
  const setJiraConfig = useSettingsStore((s) => s.setJiraConfig);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<OAuthError | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
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

  async function startFlow() {
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

  if (oauthAvailable === false) {
    return (
      <Alert className="border-amber-500/30 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTitle className="text-xs">Atlassian OAuth 설정이 필요합니다.</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          빌드 시 <code className="text-[11px]">VITE_ATLASSIAN_CLIENT_ID</code>
          와 <code className="text-[11px]">VITE_OAUTH_PROXY_URL</code> 환경
          변수를 모두 지정하세요. 현재는 API Token 방식을 사용해주세요.
        </AlertDescription>
      </Alert>
    );
  }

  if (candidate) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          연결할 사이트를 선택하세요.
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
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Atlassian 계정으로 로그인하여 권한을 부여합니다.
      </p>
      <OAuthErrorBanner error={error} />
      <Button
        onClick={() => void startFlow()}
        disabled={connecting || oauthAvailable === null}
        className="w-full"
      >
        {connecting ? (
          <>
            <Loader2 className="animate-spin" />
            연결 중...
          </>
        ) : (
          "Jira 연결하기"
        )}
      </Button>
    </div>
  );
}

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

function ApiKeyForm() {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="jira-baseUrl">워크스페이스 URL</Label>
        <Input
          id="jira-baseUrl"
          placeholder="https://your-workspace.atlassian.net"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="jira-email">이메일</Label>
        <Input
          id="jira-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="jira-token">API 토큰</Label>
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

      <Button
        onClick={handleValidate}
        disabled={!canValidate}
        className="w-full"
      >
        {validating ? (
          <>
            <Loader2 className="animate-spin" />
            검증 중...
          </>
        ) : (
          "검증"
        )}
      </Button>
    </div>
  );
}
