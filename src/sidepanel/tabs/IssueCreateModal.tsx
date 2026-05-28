import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { pruneOrphanInlineImages } from "@/store/blob-db";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useEditorStore } from "@/store/editor-store";
import { useIssuesStore } from "@/store/issues-store";
import {
  connectedPlatforms,
  jiraSiteId,
  pickInitialPlatform,
  useSettingsStore,
} from "@/store/settings-store";
import type { PlatformId } from "@/types/platform";
import { sendBg, type JiraSubmitResult } from "@/types/messages";
import { buildStyleDiff } from "@/sidepanel/components/StyleChangesTable";
import { buildAiMetaAttachment } from "@/sidepanel/lib/buildAiMetaAttachment";
import { buildIssueAdf, type AdfDoc } from "@/sidepanel/lib/buildIssueAdf";
import { buildCaptureFiles, type CaptureFiles } from "@/sidepanel/lib/buildCaptureFiles";
import { annotateAttachmentDimensions } from "@/sidepanel/lib/attachmentDimensions";
import type { JiraAttachmentInput } from "@/types/jira";
import {
  buildNetworkLogSummary,
  buildConsoleLogSummary,
} from "@/sidepanel/lib/buildLogSummary";
import type { MarkdownContext } from "@/sidepanel/lib/buildIssueMarkdown";
import { parseChromeVersion } from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import type { NormalizedSubmitResult } from "@/types/platform";
import { submitToGithub } from "@/sidepanel/lib/submitToGithub";
import { submitToLinear } from "@/sidepanel/lib/submitToLinear";
import { submitToNotion } from "@/sidepanel/lib/submitToNotion";
import { extractInlineRefs, resolveInlineImagesForSections, type InlineImageInput } from "@/sidepanel/lib/resolveInlineImages";
import type { NotionDatabaseSchema } from "@/types/notion";
import { extractNotionPageId } from "@/lib/notion-page-id";
import { SubmitFieldsDialog } from "@/sidepanel/tabs/SubmitFieldsDialog";
import { usePlatformFields } from "@/sidepanel/hooks/usePlatformFields";

export function IssueCreateModal() {
  const t = useT();
  const [open, setOpen] = useState(false);

  const accounts = useSettingsStore((s) => s.accounts);
  const lastSubmittedPlatform = useSettingsStore((s) => s.lastSubmittedPlatform);
  const lastGhSubmit = useSettingsStore((s) => s.lastSubmitFields.github);
  const lastLinearSubmit = useSettingsStore((s) => s.lastSubmitFields.linear);
  const lastNotionSubmit = useSettingsStore((s) => s.lastSubmitFields.notion);
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

  const {
    ghFields,
    setGhFields,
    linearFields,
    setLinearFields,
    notionFields,
    setNotionFields,
  } = usePlatformFields({
    open,
    lastGhSubmit,
    ghDefaults: ghAccount?.defaults,
    lastLinearSubmit,
    linearDefaults: linearAccount?.defaults,
    lastNotionSubmit,
    notionDefaults: notionAccount?.defaults,
  });
  const [notionSchema, setNotionSchema] = useState<NotionDatabaseSchema | null>(null);

  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => s.target);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const tokens = useEditorStore((s) => s.tokens);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const screenshotAnnotated = useEditorStore((s) => s.screenshotAnnotated);
  const screenshotRaw = useEditorStore((s) => s.screenshotRaw);
  const screenshotViewport = useEditorStore((s) => s.screenshotViewport);
  const screenshotCapturedAt = useEditorStore((s) => s.screenshotCapturedAt);
  const videoBlob = useEditorStore((s) => s.videoBlob);
  const videoThumbnail = useEditorStore((s) => s.videoThumbnail);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const videoStartedAt = useEditorStore((s) => s.videoStartedAt);
  const videoEndedAt = useEditorStore((s) => s.videoEndedAt);
  const draft = useEditorStore((s) => s.draft);
  const issueFields = useEditorStore((s) => s.issueFields);
  const setIssueFields = useEditorStore((s) => s.setIssueFields);
  const onSubmitted = useEditorStore((s) => s.onSubmitted);
  const networkLog = useEditorStore((s) => s.networkLog);
  const networkLogAttach = useEditorStore((s) => s.networkLogAttach);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const consoleLogAttach = useEditorStore((s) => s.consoleLogAttach);
  const actionLog = useEditorStore((s) => s.actionLog);
  const actionLogAttach = useEditorStore((s) => s.actionLogAttach);
  const sectionConfig = useSettingsUiStore((s) => s.issueSections);

  const currentIssueId = useEditorStore((s) => s.currentIssueId);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);
  const patchIssue = useIssuesStore((s) => s.patchIssue);

  function buildCtx(): MarkdownContext {
    if (!draft || !target) throw new Error(t("create.requiredMissing"));
    const os = getOsInfo();
    const browser = parseChromeVersion(navigator.userAgent);
    if (captureMode === "freeform") {
      const hasNetworkLog = networkLogAttach && networkLog && networkLog.captured > 0;
      const hasConsoleLog = consoleLogAttach && consoleLog && consoleLog.captured > 0;
      const { freeformViewport, freeformCapturedAt } = useEditorStore.getState();
      return {
        os,
        browser,
        captureMode: "freeform",
        title: draft.title,
        sections: draft.sections,
        sectionConfig,
        url: target.url,
        selector: "",
        tagName: "",
        classListBefore: [],
        classListAfter: [],
        specifiedStyles: {},
        tokens: [],
        viewport: freeformViewport,
        capturedAt: freeformCapturedAt ?? Date.now(),
        diffs: [],
        environment: draft.environment ?? [],
        networkLogSummary: hasNetworkLog ? buildNetworkLogSummary(networkLog!) : undefined,
        consoleLogSummary: hasConsoleLog ? buildConsoleLogSummary(consoleLog!) : undefined,
      };
    }
    if (captureMode === "video") {
      const hasNetworkLog = networkLogAttach && networkLog && networkLog.captured > 0;
      const hasConsoleLog = consoleLogAttach && consoleLog && consoleLog.captured > 0;
      return {
        os,
        browser,
        captureMode: "video",
        title: draft.title,
        sections: draft.sections,
        sectionConfig,
        url: target.url,
        selector: "",
        tagName: "",
        classListBefore: [],
        classListAfter: [],
        specifiedStyles: {},
        tokens: [],
        viewport: videoViewport ?? { width: 0, height: 0 },
        capturedAt: videoCapturedAt ?? Date.now(),
        diffs: [],
        environment: draft.environment ?? [],
        networkLogSummary: hasNetworkLog ? buildNetworkLogSummary(networkLog!) : undefined,
        consoleLogSummary: hasConsoleLog ? buildConsoleLogSummary(consoleLog!) : undefined,
      };
    }
    if (captureMode === "screenshot") {
      return {
        os,
        browser,
        captureMode: "screenshot",
        title: draft.title,
        sections: draft.sections,
        sectionConfig,
        url: target.url,
        selector: "",
        tagName: "",
        classListBefore: [],
        classListAfter: [],
        specifiedStyles: {},
        tokens: [],
        viewport: screenshotViewport ?? { width: 0, height: 0 },
        capturedAt: screenshotCapturedAt ?? Date.now(),
        diffs: [],
        environment: draft.environment ?? [],
      };
    }
    if (!selection) throw new Error(t("create.requiredMissing"));
    return {
      os,
      browser,
      title: draft.title,
      sections: draft.sections,
      sectionConfig,
      url: target.url,
      selector: selection.selector,
      tagName: selection.tagName,
      classListBefore: selection.classList,
      classListAfter: styleEdits.classList,
      specifiedStyles: selection.specifiedStyles,
      tokens: tokens.map((tk) => ({ name: tk.name, value: tk.value })),
      viewport: selection.viewport,
      capturedAt: selection.capturedAt,
      diffs: buildStyleDiff(selection, styleEdits),
      environment: draft.environment ?? [],
    };
  }

  async function buildEditorCaptureFiles(): Promise<CaptureFiles> {
    const hasNet = networkLogAttach && !!networkLog && networkLog.captured > 0;
    const hasCon = consoleLogAttach && !!consoleLog && consoleLog.captured > 0;
    const hasAct = actionLogAttach && !!actionLog && actionLog.captured > 0;
    const isElementNoDiff =
      captureMode === "element" &&
      selection != null &&
      buildStyleDiff(selection, styleEdits).length === 0;
    return buildCaptureFiles({
      captureMode: isElementNoDiff ? "screenshot" : captureMode,
      videoBlob,
      screenshotImage: isElementNoDiff ? beforeImage : captureMode === "screenshot" ? (screenshotAnnotated ?? screenshotRaw) : null,
      beforeImage: captureMode === "element" && !isElementNoDiff ? beforeImage : null,
      afterImage: captureMode === "element" && !isElementNoDiff ? afterImage : null,
      networkLog: hasNet ? networkLog : null,
      consoleLog: hasCon ? consoleLog : null,
      actionLog: hasAct ? actionLog : null,
      videoStartedAt: videoStartedAt ?? undefined,
      videoEndedAt: videoEndedAt ?? undefined,
      videoThumbnail,
      pageUrl: target?.url ?? "",
    });
  }

  async function handleJiraSubmit(
    ctx: MarkdownContext,
    inlineImages: InlineImageInput[],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!jiraAccount?.auth || !jiraAccount.projectKey) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
    }
    if (!issueFields.issueTypeId) throw new Error(t("create.requiredMissing"));
    const description: AdfDoc = buildIssueAdf(ctx, inlineImages.map((i) => i.refId));
    const rawAttachments: JiraAttachmentInput[] = [
      buildAiMetaAttachment(ctx),
      ...captureFiles.images,
      ...(captureFiles.video ? [captureFiles.video] : []),
      ...captureFiles.logs,
    ];
    for (const img of inlineImages) {
      rawAttachments.push({ filename: `inline-${img.refId}.webp`, dataUrl: img.dataUrl });
    }
    const attachments = await annotateAttachmentDimensions(rawAttachments);

    const result = await sendBg<JiraSubmitResult>({
      type: "jira.submitIssue",
      payload: {
        projectKey: jiraAccount.projectKey,
        summary: draft!.title.trim(),
        description,
        issueTypeId: issueFields.issueTypeId,
        assigneeAccountId: issueFields.assigneeId,
        priorityId: issueFields.priorityId,
        parentKey: issueFields.parentKey,
      },
      attachments,
      relatesKey: issueFields.relatesKey,
    });
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
    useSettingsStore.getState().setLastSubmitFields("jira", {
      projectKey: jiraAccount.projectKey,
      assigneeId: issueFields.assigneeId,
      assigneeName: issueFields.assigneeName,
      priorityId: issueFields.priorityId,
      priorityName: issueFields.priorityName,
      parentKey: issueFields.parentKey,
      parentLabel: issueFields.parentLabel,
      relatesKey: issueFields.relatesKey,
      relatesLabel: issueFields.relatesLabel,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("jira");
    onSubmitted({ key: result.key, url: result.url });
    return { key: result.key, url: result.url };
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

    const result = await submitToGithub({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      inlineImages,
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignee: ghFields.assignee,
    });
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
    useSettingsStore.getState().setLastSubmitFields("github", {
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignee: ghFields.assignee,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("github");
    onSubmitted({ key: result.key, url: result.url });
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

    const result = await submitToLinear({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      inlineImages,
      teamId: linearFields.teamId,
      projectId: linearFields.projectId,
      labelId: linearFields.labelId,
      assigneeId: linearFields.assigneeId,
      priority: linearFields.priority,
    });
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
    useSettingsStore.getState().setLastSubmitFields("linear", {
      teamId: linearFields.teamId,
      teamName: linearFields.teamName,
      teamKey: linearFields.teamKey,
      projectId: linearFields.projectId,
      projectName: linearFields.projectName,
      labelId: linearFields.labelId,
      labelName: linearFields.labelName,
      assigneeId: linearFields.assigneeId,
      assigneeName: linearFields.assigneeName,
      priority: linearFields.priority,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("linear");
    onSubmitted({ key: result.key, url: result.url });
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
    const result = await submitToNotion({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      inlineImages,
      databaseId: notionFields.databaseId,
      titlePropertyName: notionSchema.titlePropertyName,
      statusOption: notionFields.statusOption && notionSchema.statusProperty
        ? {
            propertyName: notionSchema.statusProperty.name,
            optionName: notionFields.statusOption,
          }
        : undefined,
      selectValues: notionFields.selectValues,
    });
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
    useSettingsStore.getState().setLastSubmitFields("notion", {
      databaseId: notionFields.databaseId,
      databaseTitle: notionFields.databaseTitle,
      statusOption: notionFields.statusOption,
      selectValues: notionFields.selectValues,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("notion");
    onSubmitted({ key: result.key, url: result.url });
    return result;
  }

  async function handleSubmit(submitPlatform: PlatformId): Promise<NormalizedSubmitResult> {
    const ctx = buildCtx();
    const inlineImages = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const captureFiles = await buildEditorCaptureFiles();
    let result: NormalizedSubmitResult;
    if (submitPlatform === "github") result = await handleGithubSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "linear") result = await handleLinearSubmit(ctx, inlineImages, captureFiles);
    else if (submitPlatform === "notion") result = await handleNotionSubmit(ctx, inlineImages, captureFiles);
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
      <Button
        disabled={!canOpen}
        onClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setOpen(true); }}
        title={tooltip}
      >
        {t("issue.submit")}
      </Button>
      <SubmitFieldsDialog
        open={open}
        onOpenChange={setOpen}
        platform={platform}
        setPlatform={handlePlatformChange}
        availablePlatforms={available}
        jiraFields={issueFields}
        setJiraFields={setIssueFields}
        ghFields={ghFields}
        setGhFields={setGhFields}
        linearFields={linearFields}
        setLinearFields={setLinearFields}
        notionFields={notionFields}
        setNotionFields={setNotionFields}
        onNotionSchemaResolved={setNotionSchema}
        onSubmit={handleSubmit}
      />
    </>
  );
}
