import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { pruneOrphanInlineImages, getAttachmentBlob } from "@/store/blob-db";
import type { UserAttachmentMeta } from "@/types/attachment";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useEditorStore, whenAttachmentBlobsReady } from "@/store/editor-store";
import { useIssuesStore } from "@/store/issues-store";
import {
  connectedPlatforms,
  jiraSiteId,
  pickInitialPlatform,
  useSettingsStore,
} from "@/store/settings-store";
import type { PlatformId } from "@/types/platform";
import { buildCaptureFiles, type CaptureFiles } from "@/sidepanel/lib/buildCaptureFiles";
import { buildEditorMarkdownContext, buildEditorLogsCaptureInput } from "@/sidepanel/lib/buildEditorCapture";
import { type MarkdownContext } from "@/sidepanel/lib/buildIssueMarkdown";
import type { NormalizedSubmitResult } from "@/types/platform";
import { submitToJira } from "@/sidepanel/lib/submitToJira";
import { submitToGithub } from "@/sidepanel/lib/submitToGithub";
import { submitToLinear } from "@/sidepanel/lib/submitToLinear";
import { submitToNotion } from "@/sidepanel/lib/submitToNotion";
import { submitToGitlab } from "@/sidepanel/lib/submitToGitlab";
import { submitToAsana } from "@/sidepanel/lib/submitToAsana";
import { submitToClickup } from "@/sidepanel/lib/submitToClickup";
import { submitToSlack } from "@/sidepanel/lib/submitToSlack";
import { extractInlineRefs, resolveInlineImagesForSections, type InlineImageInput } from "@/sidepanel/lib/resolveInlineImages";
import type { NotionDatabaseSchema } from "@/types/notion";
import { extractNotionPageId } from "@/lib/notion-page-id";
import { SubmitFieldsDialog } from "@/sidepanel/tabs/SubmitFieldsDialog";
import { usePlatformFields } from "@/sidepanel/hooks/usePlatformFields";
import {
  jiraSubmitArgs,
  jiraLastSubmitFields,
  githubSubmitArgs,
  githubLastSubmitFields,
  linearSubmitArgs,
  linearLastSubmitFields,
  notionSubmitArgs,
  notionLastSubmitFields,
  gitlabSubmitArgs,
  gitlabLastSubmitFields,
  asanaSubmitArgs,
  asanaLastSubmitFields,
  clickupSubmitArgs,
  clickupLastSubmitFields,
  slackSubmitArgs,
  slackLastSubmitFields,
} from "@/sidepanel/lib/submitAdapters";

export function IssueCreateModal() {
  const t = useT();
  const [open, setOpen] = useState(false);

  const accounts = useSettingsStore((s) => s.accounts);
  const lastSubmittedPlatform = useSettingsStore((s) => s.lastSubmittedPlatform);
  const lastGhSubmit = useSettingsStore((s) => s.lastSubmitFields.github);
  const lastLinearSubmit = useSettingsStore((s) => s.lastSubmitFields.linear);
  const lastNotionSubmit = useSettingsStore((s) => s.lastSubmitFields.notion);
  const lastGitlabSubmit = useSettingsStore((s) => s.lastSubmitFields.gitlab);
  const lastAsanaSubmit = useSettingsStore((s) => s.lastSubmitFields.asana);
  const lastClickupSubmit = useSettingsStore((s) => s.lastSubmitFields.clickup);
  const lastSlackSubmit = useSettingsStore((s) => s.lastSubmitFields.slack);
  const setTargetPlatform = useEditorStore((s) => s.setTargetPlatform);

  const available = useMemo(() => connectedPlatforms(accounts), [accounts]);
  const initialPlatform = useMemo(
    () => pickInitialPlatform(accounts, lastSubmittedPlatform),
    [accounts, lastSubmittedPlatform],
  );
  const [platform, setPlatform] = useState<PlatformId>(initialPlatform ?? "jira");

  // 다이얼로그가 열릴 때마다 default platform 재계산
  useEffect(() => {
    if (open && initialPlatform) {
      setPlatform(initialPlatform);
      setTargetPlatform(initialPlatform);
    }
  }, [open, initialPlatform, setTargetPlatform]);

  function handlePlatformChange(p: PlatformId) {
    setPlatform(p);
    setTargetPlatform(p);
    if (currentIssueId) patchIssue(currentIssueId, { platform: p });
  }

  const ghAccount = accounts.github;
  const jiraAccount = accounts.jira;
  const linearAccount = accounts.linear;
  const notionAccount = accounts.notion;
  const gitlabAccount = accounts.gitlab;
  const asanaAccount = accounts.asana;
  const clickupAccount = accounts.clickup;
  const slackAccount = accounts.slack;

  const {
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
  } = usePlatformFields({
    open,
    lastGhSubmit,
    ghDefaults: ghAccount?.defaults,
    lastLinearSubmit,
    linearDefaults: linearAccount?.defaults,
    lastNotionSubmit,
    notionDefaults: notionAccount?.defaults,
    lastGitlabSubmit,
    gitlabDefaults: gitlabAccount?.defaults,
    lastAsanaSubmit,
    asanaDefaults: asanaAccount?.defaults,
    lastClickupSubmit,
    clickupDefaults: clickupAccount?.defaults,
    lastSlackSubmit,
    slackDefaults: slackAccount?.defaults,
  });
  const [notionSchema, setNotionSchema] = useState<NotionDatabaseSchema | null>(null);

  const captureMode = useEditorStore((s) => s.captureMode);
  const draft = useEditorStore((s) => s.draft);
  const issueFields = useEditorStore((s) => s.issueFields);
  const setIssueFields = useEditorStore((s) => s.setIssueFields);
  const onSubmitted = useEditorStore((s) => s.onSubmitted);
  const sectionConfig = useSettingsUiStore((s) => s.issueSections);
  const attachments = useEditorStore((s) => s.attachments);
  const attachmentsEnabled = useSettingsUiStore((s) => s.attachmentsEnabled);

  const currentIssueId = useEditorStore((s) => s.currentIssueId);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);
  const markSlackShared = useIssuesStore((s) => s.markSlackShared);
  const patchIssue = useIssuesStore((s) => s.patchIssue);

  // ctx·캡처 입력은 buildEditorCapture(단일 출처)에 위임 — 패널 로그 다운로드와 동일한 logs.html 보장.
  function buildCtx(): MarkdownContext {
    const ctx = buildEditorMarkdownContext();
    if (!ctx) throw new Error(t("create.requiredMissing"));
    return ctx;
  }

  async function buildEditorCaptureFiles(ctx: MarkdownContext): Promise<CaptureFiles> {
    // 사용자 첨부: 토글 ON이고 issueId 확정 상태면 IndexedDB에서 Blob 로드.
    const userAttachmentMetas = attachmentsEnabled ? attachments : [];
    let userAttachments: { meta: UserAttachmentMeta; blob: Blob }[] | undefined;
    if (userAttachmentMetas.length && currentIssueId) {
      // confirmDraft의 pending→issueId rekey가 끝난 뒤 로드(issueId 키 미존재 레이스 방지).
      await whenAttachmentBlobsReady();
      const loaded = await Promise.all(
        userAttachmentMetas.map(async (meta) => {
          const blob = await getAttachmentBlob(currentIssueId, meta.id);
          return blob ? { meta, blob } : null;
        }),
      );
      userAttachments = loaded.filter(
        (x): x is { meta: UserAttachmentMeta; blob: Blob } => x !== null,
      );
    }
    // logs/images/video는 단일 출처와 동일, userAttachments만 제출 경로 고유.
    return buildCaptureFiles({
      ...buildEditorLogsCaptureInput(ctx),
      userAttachments,
    });
  }

  async function handleJiraSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    // 유효 프로젝트는 이번 제출의 필드값이고 계정 설정은 fallback일 뿐이다 —
    // accounts.jira.projectKey를 제출 payload에 직접 쓰지 않는다.
    const projectKey = issueFields.projectKey ?? jiraAccount?.projectKey;
    if (!jiraAccount?.auth || !projectKey) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
    }
    if (!issueFields.issueTypeId) throw new Error(t("create.requiredMissing"));
    const result = await submitToJira(
      jiraSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: issueFields,
        projectKey,
        issueTypeId: issueFields.issueTypeId,
        summary: draft!.title,
      }),
    );
    if (currentIssueId) {
      markSubmitted(currentIssueId, {
        platform: "jira",
        key: result.key,
        url: result.url,
        jiraSiteId: jiraSiteId(jiraAccount.auth),
        issueTypeName: jiraAccount.issueTypeName,
        priorityName: issueFields.priorityName,
        assigneeName: issueFields.assigneeName,
      });
    }
    useSettingsStore.getState().setLastSubmitFields(
      "jira",
      jiraLastSubmitFields({
        fields: issueFields,
        projectKey,
        issueTypeId: issueFields.issueTypeId,
        siteId: jiraSiteId(jiraAccount.auth),
      }),
    );
    useSettingsStore.getState().setLastSubmittedPlatform("jira");
    onSubmitted({ key: result.key, url: result.url, platform: "jira", logsDropped: result.logsDropped });
    return { key: result.key, url: result.url, logsDropped: result.logsDropped };
  }

  async function handleGithubSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!ghAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.github") }));
    }
    if (!ghFields.owner || !ghFields.repo) throw new Error(t("create.requiredMissing"));

    const result = await submitToGithub(
      githubSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: ghFields,
        owner: ghFields.owner,
        repo: ghFields.repo,
      }),
    );
    if (currentIssueId) {
      markSubmitted(currentIssueId, {
        platform: "github",
        key: result.key,
        url: result.url,
        githubOwner: ghFields.owner,
        githubRepo: ghFields.repo,
        githubLabels: ghFields.label ? [ghFields.label] : undefined,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("github", githubLastSubmitFields(ghFields));
    useSettingsStore.getState().setLastSubmittedPlatform("github");
    onSubmitted({ key: result.key, url: result.url, platform: "github", logsDropped: result.logsDropped });
    return result;
  }

  async function handleLinearSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!linearAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.linear") }));
    }
    if (!linearFields.teamId) throw new Error(t("create.requiredMissing"));

    const result = await submitToLinear(
      linearSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: linearFields,
        teamId: linearFields.teamId,
      }),
    );
    if (currentIssueId) {
      markSubmitted(currentIssueId, {
        platform: "linear",
        key: result.key,
        url: result.url,
        linearIdentifier: result.key,
        linearTeamKey: linearFields.teamKey,
        linearLabelName: linearFields.labelName,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("linear", linearLastSubmitFields(linearFields));
    useSettingsStore.getState().setLastSubmittedPlatform("linear");
    onSubmitted({ key: result.key, url: result.url, platform: "linear", logsDropped: result.logsDropped });
    return result;
  }

  async function handleNotionSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!notionAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.notion") }));
    }
    if (!notionFields.databaseId || !notionSchema) {
      throw new Error(t("create.requiredMissing"));
    }
    const result = await submitToNotion(
      notionSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: notionFields,
        databaseId: notionFields.databaseId,
        schema: notionSchema,
      }),
    );
    if (currentIssueId) {
      const pageId = extractNotionPageId(result.url);
      markSubmitted(currentIssueId, {
        platform: "notion",
        key: result.key,
        url: result.url,
        notionPageId: pageId ?? undefined,
        notionDatabaseId: notionFields.databaseId,
        notionDatabaseTitle: notionFields.databaseTitle,
        notionStatusOption: notionFields.statusOption,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("notion", notionLastSubmitFields(notionFields));
    useSettingsStore.getState().setLastSubmittedPlatform("notion");
    onSubmitted({ key: result.key, url: result.url, platform: "notion", logsDropped: result.logsDropped });
    return result;
  }

  async function handleGitlabSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!gitlabAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.gitlab") }));
    }
    if (!gitlabFields.projectId) throw new Error(t("create.requiredMissing"));

    const result = await submitToGitlab(
      gitlabSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: gitlabFields,
        projectId: gitlabFields.projectId,
      }),
    );
    if (currentIssueId) {
      markSubmitted(currentIssueId, {
        platform: "gitlab",
        key: result.key,
        url: result.url,
        gitlabProjectId: gitlabFields.projectId,
        gitlabIssueIid: Number(result.key.replace(/^#/, "")),
        gitlabLabels: gitlabFields.label ? [gitlabFields.label] : undefined,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("gitlab", gitlabLastSubmitFields(gitlabFields));
    useSettingsStore.getState().setLastSubmittedPlatform("gitlab");
    onSubmitted({ key: result.key, url: result.url, platform: "gitlab", logsDropped: result.logsDropped });
    return result;
  }

  async function handleAsanaSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!asanaAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.asana") }));
    }
    if (!asanaFields.workspaceGid) throw new Error(t("create.requiredMissing"));

    const result = await submitToAsana(
      asanaSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: asanaFields,
        workspaceGid: asanaFields.workspaceGid,
      }),
    );
    if (currentIssueId) {
      markSubmitted(currentIssueId, {
        platform: "asana",
        key: result.key,
        url: result.url,
        asanaTaskGid: result.key,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("asana", asanaLastSubmitFields(asanaFields));
    useSettingsStore.getState().setLastSubmittedPlatform("asana");
    onSubmitted({ key: result.key, url: result.url, platform: "asana", logsDropped: result.logsDropped });
    return result;
  }

  async function handleClickupSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!clickupAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.clickup") }));
    }
    if (!clickupFields.workspaceId || !clickupFields.listId) {
      throw new Error(t("create.requiredMissing"));
    }

    const result = await submitToClickup(
      clickupSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: clickupFields,
        listId: clickupFields.listId,
      }),
    );
    if (currentIssueId) {
      markSubmitted(currentIssueId, {
        platform: "clickup",
        key: result.key,
        url: result.url,
        clickupTaskId: result.key,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("clickup", clickupLastSubmitFields(clickupFields));
    useSettingsStore.getState().setLastSubmittedPlatform("clickup");
    onSubmitted({ key: result.key, url: result.url, platform: "clickup", logsDropped: result.logsDropped });
    return result;
  }

  async function handleSlackSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!slackAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.slack") }));
    }
    if (!slackFields.channelId) throw new Error(t("create.requiredMissing"));

    const result = await submitToSlack(
      slackSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: slackFields,
        channelId: slackFields.channelId,
      }),
    );
    if (currentIssueId) {
      markSlackShared(currentIssueId, {
        key: result.key,
        url: result.url,
      });
    }
    useSettingsStore.getState().setLastSubmitFields("slack", slackLastSubmitFields(slackFields));
    useSettingsStore.getState().setLastSubmittedPlatform("slack");
    onSubmitted({ key: result.key, url: result.url, platform: "slack", logsDropped: result.logsDropped });
    return result;
  }

  async function handleSubmit(submitPlatform: PlatformId): Promise<NormalizedSubmitResult> {
    const ctx = buildCtx();
    const inlineImages = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const captureFiles = await buildEditorCaptureFiles(ctx);
    let result: NormalizedSubmitResult;
    if (submitPlatform === "github") result = await handleGithubSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "linear") result = await handleLinearSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "notion") result = await handleNotionSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "gitlab") result = await handleGitlabSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "asana") result = await handleAsanaSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "clickup") result = await handleClickupSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "slack") result = await handleSlackSubmit(ctx, inlineImages, captureFiles);
    else result = await handleJiraSubmit(ctx, inlineImages, captureFiles);
    const activeRefs = extractInlineRefs(
      Object.values(draft?.sections ?? {}).join("\n"),
    );
    void pruneOrphanInlineImages(activeRefs);
    return result;
  }

  const canOpen = available.length > 0;
  const tooltip = canOpen
    ? undefined
    : t("platform.empty.title");

  return (
    <>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="issue-submit-open"
              aria-disabled={!canOpen}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => {
                if (!canOpen) return;
                (document.activeElement as HTMLElement)?.blur?.();
                setOpen(true);
              }}
            >
              {t("issue.submit")}
            </Button>
          </TooltipTrigger>
          {/* disabled면 base cva의 disabled:pointer-events-none이 hover를 죽여 이유가 영영 안 뜬다.
              aria-disabled는 hover가 살아 있으므로 왜 못 누르는지를 함께 말해준다. */}
          {tooltip && (
            <TooltipContent data-testid="issue-submit-disabled-reason" className="max-w-60">
              {tooltip}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <SubmitFieldsDialog
        open={open}
        onOpenChange={setOpen}
        platform={platform}
        setPlatform={handlePlatformChange}
        captureMode={captureMode}
        availablePlatforms={available}
        jiraFields={issueFields}
        setJiraFields={setIssueFields}
        ghFields={ghFields}
        setGhFields={setGhFields}
        linearFields={linearFields}
        setLinearFields={setLinearFields}
        notionFields={notionFields}
        setNotionFields={setNotionFields}
        gitlabFields={gitlabFields}
        setGitlabFields={setGitlabFields}
        asanaFields={asanaFields}
        setAsanaFields={setAsanaFields}
        clickupFields={clickupFields}
        setClickupFields={setClickupFields}
        slackFields={slackFields}
        setSlackFields={setSlackFields}
        onNotionSchemaResolved={setNotionSchema}
        onSubmit={handleSubmit}
      />
    </>
  );
}
