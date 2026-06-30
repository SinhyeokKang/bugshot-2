import { useEffect, useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { SlackIcon } from "@/components/icons/SlackIcon";
import {
  SiAsana,
  SiClickup,
  SiGithub,
  SiGitlab,
  SiJirasoftware,
  SiLinear,
  SiNotion,
} from "@icons-pack/react-simple-icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { trackSubmit } from "@/sidepanel/lib/track-submit";
import type { CaptureMode, EditorIssueFields } from "@/store/editor-store";
import {
  isJiraAccountComplete,
  isLinearAccountComplete,
  isNotionAccountComplete,
  useSettingsStore,
} from "@/store/settings-store";
import { PLATFORM_TAB_KEYS, type PlatformId, type NormalizedSubmitResult } from "@/types/platform";
import type { NotionDatabaseSchema } from "@/types/notion";
import {
  GithubIssueFields,
  type GithubIssueFieldsValue,
} from "./githubFields/GithubIssueFields";
import {
  LinearIssueFields,
  type LinearIssueFieldsValue,
} from "./linearFields/LinearIssueFields";
import {
  NotionIssueFields,
  type NotionIssueFieldsValue,
} from "./notionFields/NotionIssueFields";
import {
  GitlabIssueFields,
  type GitlabIssueFieldsValue,
} from "./gitlabFields/GitlabIssueFields";
import {
  AsanaIssueFields,
  type AsanaIssueFieldsValue,
} from "./asanaFields/AsanaIssueFields";
import {
  ClickupIssueFields,
  type ClickupIssueFieldsValue,
} from "./clickupFields/ClickupIssueFields";
import {
  SlackIssueFields,
  type SlackIssueFieldsValue,
} from "./slackFields/SlackIssueFields";
import { JiraIssueFields } from "./jiraFields/JiraIssueFields";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" };

export interface SubmitFieldsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  platform: PlatformId;
  setPlatform: (p: PlatformId) => void;
  captureMode?: CaptureMode;
  availablePlatforms: PlatformId[];
  jiraFields: EditorIssueFields;
  setJiraFields: (patch: Partial<EditorIssueFields>) => void;
  ghFields: GithubIssueFieldsValue;
  setGhFields: (patch: Partial<GithubIssueFieldsValue>) => void;
  linearFields: LinearIssueFieldsValue;
  setLinearFields: (patch: Partial<LinearIssueFieldsValue>) => void;
  notionFields: NotionIssueFieldsValue;
  setNotionFields: (patch: Partial<NotionIssueFieldsValue>) => void;
  gitlabFields: GitlabIssueFieldsValue;
  setGitlabFields: (patch: Partial<GitlabIssueFieldsValue>) => void;
  asanaFields: AsanaIssueFieldsValue;
  setAsanaFields: (patch: Partial<AsanaIssueFieldsValue>) => void;
  clickupFields: ClickupIssueFieldsValue;
  setClickupFields: (patch: Partial<ClickupIssueFieldsValue>) => void;
  slackFields: SlackIssueFieldsValue;
  setSlackFields: (patch: Partial<SlackIssueFieldsValue>) => void;
  onNotionSchemaResolved: (schema: NotionDatabaseSchema | null) => void;
  onSubmit: (platform: PlatformId) => Promise<NormalizedSubmitResult>;
  onSuccess?: (result: NormalizedSubmitResult) => void;
}

// Tailwind JIT 정적 추출을 위해 full class 문자열을 매핑.
const TABS_GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

const PLATFORM_TABS: {
  id: PlatformId;
  Icon: ComponentType<{ className?: string; color?: string }>;
  invertOnDark?: boolean;
}[] = [
  { id: "jira", Icon: SiJirasoftware },
  { id: "github", Icon: SiGithub, invertOnDark: true },
  { id: "linear", Icon: SiLinear },
  { id: "notion", Icon: SiNotion, invertOnDark: true },
  { id: "gitlab", Icon: SiGitlab },
  { id: "asana", Icon: SiAsana },
  { id: "clickup", Icon: SiClickup },
  // lucide 아이콘은 color="default"(브랜드 hex)를 못 받아 투명해진다 → currentColor로 렌더.
  { id: "slack", Icon: ({ className }) => <SlackIcon className={className} /> },
];

export function SubmitFieldsDialog(props: SubmitFieldsDialogProps) {
  const {
    open,
    onOpenChange,
    title,
    platform,
    setPlatform,
    captureMode,
    availablePlatforms,
    jiraFields,
    setJiraFields,
    ghFields,
    setGhFields,
    linearFields,
    setLinearFields,
    notionFields,
    setNotionFields,
    gitlabFields,
    setGitlabFields,
    asanaFields,
    setAsanaFields,
    clickupFields,
    setClickupFields,
    slackFields,
    setSlackFields,
    onNotionSchemaResolved,
    onSubmit,
    onSuccess,
  } = props;
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const ghAccount = useSettingsStore((s) => s.accounts.github);
  const linearAccount = useSettingsStore((s) => s.accounts.linear);
  const notionAccount = useSettingsStore((s) => s.accounts.notion);
  const gitlabAccount = useSettingsStore((s) => s.accounts.gitlab);
  const asanaAccount = useSettingsStore((s) => s.accounts.asana);
  const clickupAccount = useSettingsStore((s) => s.accounts.clickup);
  const slackAccount = useSettingsStore((s) => s.accounts.slack);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    if (!open) setSubmit({ status: "idle" });
  }, [open]);

  const jiraConfigured = isJiraAccountComplete(jiraAccount);
  const ghConfigured = !!ghAccount;
  const linearConfigured = isLinearAccountComplete(linearAccount);
  const notionConfigured = isNotionAccountComplete(notionAccount);
  const gitlabConfigured = !!gitlabAccount;
  const asanaConfigured = !!asanaAccount;
  const clickupConfigured = !!clickupAccount;
  const slackConfigured = !!slackAccount;
  // 삼항 체인은 clickup 누락이 조용히 Notion으로 새므로 exhaustive switch로 전환 (회귀 방지).
  const platformConfigured = ((): boolean => {
    switch (platform) {
      case "jira": return jiraConfigured;
      case "github": return ghConfigured;
      case "linear": return linearConfigured;
      case "gitlab": return gitlabConfigured;
      case "asana": return asanaConfigured;
      case "clickup": return clickupConfigured;
      case "slack": return slackConfigured;
      case "notion": return notionConfigured;
      default: {
        const _exhaustive: never = platform;
        return _exhaustive;
      }
    }
  })();

  const fieldsReady = ((): boolean => {
    switch (platform) {
      case "jira": return !!jiraFields.issueTypeId;
      case "github": return !!ghFields.owner && !!ghFields.repo;
      case "linear": return !!linearFields.teamId;
      case "gitlab": return !!gitlabFields.projectId;
      case "asana": return !!asanaFields.workspaceGid;
      case "clickup": return !!clickupFields.workspaceId && !!clickupFields.listId;
      case "slack": return !!slackFields.channelId;
      case "notion": return !!notionFields.databaseId;
      default: {
        const _exhaustive: never = platform;
        return _exhaustive;
      }
    }
  })();

  const canSubmit =
    submit.status !== "submitting" && platformConfigured && fieldsReady;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmit({ status: "submitting" });
    let result: NormalizedSubmitResult;
    try {
      result = await onSubmit(platform);
    } catch (err) {
      // result는 onSubmit 성공/예외에만 묶는다. onSuccess/onOpenChange 예외가
      // failure로 오집계·toast 오표시되지 않게 try를 onSubmit으로 좁힌다.
      trackSubmit(platform, captureMode, "failure");
      const ccCount = {
        jira: jiraFields.cc?.length,
        github: ghFields.cc?.length,
        linear: linearFields.cc?.length,
        gitlab: gitlabFields.cc?.length,
        asana: asanaFields.cc?.length,
        clickup: clickupFields.cc?.length,
        slack: undefined,
        notion: notionFields.cc?.length,
      }[platform];
      toast.error(
        err instanceof Error ? err.message : String(err),
        ccCount ? { description: t("field.cc.submitErrorHint") } : undefined,
      );
      setSubmit({ status: "idle" });
      return;
    }
    trackSubmit(platform, captureMode, "success");
    onOpenChange(false);
    onSuccess?.(result);
  }

  function handleOpenChange(next: boolean) {
    if (submit.status === "submitting") return;
    if (!next) (document.activeElement as HTMLElement)?.blur?.();
    onOpenChange(next);
  }

  const showTabs = availablePlatforms.length > 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl" data-testid="submit-fields-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl">{title ?? t("issue.submit")}</DialogTitle>
        </DialogHeader>

        {showTabs ? (
          <Tabs value={platform} onValueChange={(v) => setPlatform(v as PlatformId)}>
            <CollapsingTabsList className={cn(
              "grid h-9 w-full",
              TABS_GRID_COLS[availablePlatforms.length] ?? "grid-cols-2",
            )}>
              {PLATFORM_TABS.filter((p) => availablePlatforms.includes(p.id)).map(
                ({ id, Icon, invertOnDark }) => (
                  <TabsTrigger key={id} value={id} className="min-w-0 gap-1.5" data-testid={`platform-tab-${id}`}>
                    <Icon
                      className={cn("h-3.5 w-3.5 shrink-0", invertOnDark && "dark:invert")}
                      color="default"
                    />
                    <TabLabel>{t(PLATFORM_TAB_KEYS[id])}</TabLabel>
                  </TabsTrigger>
                ),
              )}
            </CollapsingTabsList>
          </Tabs>
        ) : null}

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        {platform === "jira" ? (
          jiraConfigured ? (
            <JiraIssueFields fields={jiraFields} onChange={setJiraFields} />
          ) : null
        ) : platform === "github" ? (
          ghConfigured ? (
            <GithubIssueFields value={ghFields} onChange={setGhFields} />
          ) : null
        ) : platform === "linear" ? (
          linearConfigured ? (
            <LinearIssueFields value={linearFields} onChange={setLinearFields} />
          ) : null
        ) : platform === "gitlab" ? (
          gitlabConfigured ? (
            <GitlabIssueFields value={gitlabFields} onChange={setGitlabFields} />
          ) : null
        ) : platform === "asana" ? (
          asanaConfigured ? (
            <AsanaIssueFields value={asanaFields} onChange={setAsanaFields} />
          ) : null
        ) : platform === "clickup" ? (
          clickupConfigured ? (
            <ClickupIssueFields value={clickupFields} onChange={setClickupFields} />
          ) : null
        ) : platform === "slack" ? (
          slackConfigured ? (
            <SlackIssueFields value={slackFields} onChange={setSlackFields} />
          ) : null
        ) : notionConfigured ? (
          <NotionIssueFields
            value={notionFields}
            onChange={setNotionFields}
            onSchemaResolved={onNotionSchemaResolved}
          />
        ) : null}
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submit.status === "submitting"}
          >
            {t("common.close")}
          </Button>
          <Button
            data-testid="submit-issue-confirm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="relative"
          >
            {submit.status === "submitting" && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={submit.status === "submitting" ? "opacity-0" : undefined}>
              {t("common.submit")}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
