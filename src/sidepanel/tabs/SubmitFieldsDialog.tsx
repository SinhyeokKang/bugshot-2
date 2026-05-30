import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { EditorIssueFields } from "@/store/editor-store";
import {
  isJiraAccountComplete,
  isLinearAccountComplete,
  isNotionAccountComplete,
  useSettingsStore,
} from "@/store/settings-store";
import type { PlatformId, NormalizedSubmitResult } from "@/types/platform";
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
};

export function SubmitFieldsDialog(props: SubmitFieldsDialogProps) {
  const {
    open,
    onOpenChange,
    title,
    platform,
    setPlatform,
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
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    if (!open) setSubmit({ status: "idle" });
  }, [open]);

  const jiraConfigured = isJiraAccountComplete(jiraAccount);
  const ghConfigured = !!ghAccount;
  const linearConfigured = isLinearAccountComplete(linearAccount);
  const notionConfigured = isNotionAccountComplete(notionAccount);
  const gitlabConfigured = !!gitlabAccount;
  const platformConfigured =
    platform === "jira"
      ? jiraConfigured
      : platform === "github"
        ? ghConfigured
        : platform === "linear"
          ? linearConfigured
          : platform === "gitlab"
            ? gitlabConfigured
            : notionConfigured;

  const canSubmit =
    submit.status !== "submitting" &&
    platformConfigured &&
    (platform === "jira"
      ? !!jiraFields.issueTypeId
      : platform === "github"
        ? !!ghFields.owner && !!ghFields.repo
        : platform === "linear"
          ? !!linearFields.teamId
          : platform === "gitlab"
            ? !!gitlabFields.projectId
            : !!notionFields.databaseId);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmit({ status: "submitting" });
    try {
      const result = await onSubmit(platform);
      onOpenChange(false);
      onSuccess?.(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmit({ status: "idle" });
    }
  }

  function handleOpenChange(next: boolean) {
    if (submit.status === "submitting") return;
    if (!next) (document.activeElement as HTMLElement)?.blur?.();
    onOpenChange(next);
  }

  const showTabs = availablePlatforms.length > 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{title ?? t("issue.submit")}</DialogTitle>
        </DialogHeader>

        {showTabs ? (
          <Tabs value={platform} onValueChange={(v) => setPlatform(v as PlatformId)}>
            <TabsList className={cn(
              "grid h-9 w-full",
              TABS_GRID_COLS[availablePlatforms.length] ?? "grid-cols-2",
            )}>
              {availablePlatforms.includes("jira") && (
                <TabsTrigger value="jira" className="gap-1.5">
                  <SiJirasoftware className="h-3.5 w-3.5" color="default" />
                  {t("platform.tab.jira")}
                </TabsTrigger>
              )}
              {availablePlatforms.includes("github") && (
                <TabsTrigger value="github" className="gap-1.5">
                  <SiGithub className="h-3.5 w-3.5 dark:invert" color="default" />
                  {t("platform.tab.github")}
                </TabsTrigger>
              )}
              {availablePlatforms.includes("linear") && (
                <TabsTrigger value="linear" className="gap-1.5">
                  <SiLinear className="h-3.5 w-3.5" color="default" />
                  {t("platform.tab.linear")}
                </TabsTrigger>
              )}
              {availablePlatforms.includes("notion") && (
                <TabsTrigger value="notion" className="gap-1.5">
                  <SiNotion className="h-3.5 w-3.5 dark:invert" color="default" />
                  {t("platform.tab.notion")}
                </TabsTrigger>
              )}
              {availablePlatforms.includes("gitlab") && (
                <TabsTrigger value="gitlab" className="gap-1.5">
                  <SiGitlab className="h-3.5 w-3.5" color="default" />
                  {t("platform.tab.gitlab")}
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        ) : null}

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
        ) : notionConfigured ? (
          <NotionIssueFields
            value={notionFields}
            onChange={setNotionFields}
            onSchemaResolved={onNotionSchemaResolved}
          />
        ) : null}

        <DialogFooter className="flex-row justify-end">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submit.status === "submitting"}
          >
            {t("common.close")}
          </Button>
          <Button
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
