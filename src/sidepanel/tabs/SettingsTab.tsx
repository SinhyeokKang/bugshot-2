import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  useSettingsStore,
  type JiraConfig,
} from "@/store/settings-store";
import type { JiraMyself } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { IssueTypeCombobox } from "./IssueTypeCombobox";
import { ProjectCombobox } from "./ProjectCombobox";

export function SettingsTab() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const connected = !!jiraConfig;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Jira 연결</h2>
        {connected ? <JiraSummary /> : <JiraForm />}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">프로젝트</h2>
        {connected ? <ProjectCombobox /> : null}
      </section>

      {connected ? (
        <>
          <Separator />

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">이슈 설정</h2>

            <div className="grid gap-1.5">
              <Label>기본 이슈 타입</Label>
              <IssueTypeCombobox />
            </div>

            <TitlePrefixField />
          </section>
        </>
      ) : null}
    </div>
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

  let host = jiraConfig.baseUrl;
  try {
    host = new URL(jiraConfig.baseUrl).hostname;
  } catch {
    /* keep raw */
  }

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5 text-xs">
        <span className="truncate font-mono text-foreground">{host}</span>
        <span className="truncate text-muted-foreground">
          {jiraConfig.email}
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={() => clearJiraConfig()}>
        재설정
      </Button>
    </div>
  );
}

function JiraForm() {
  const setJiraConfig = useSettingsStore((s) => s.setJiraConfig);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const trimmed = {
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
        config: trimmed,
      });
      const next: JiraConfig = { ...trimmed };
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
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
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
