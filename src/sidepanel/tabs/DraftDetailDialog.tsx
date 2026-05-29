import { useEffect, useMemo, useState } from "react";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { getVideoBlob, getImageBlob, getNetworkLog, getConsoleLog, getActionLog, blobToDataUrl, pruneOrphanInlineImages } from "@/store/blob-db";
import { useIssueImages } from "@/sidepanel/hooks/useIssueImages";
import { Info } from "lucide-react";
import { useT, dateBcp47 } from "@/i18n";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatElementName } from "@/lib/element-label";
import {
  POST_MEDIA_SECTION_IDS,
  sectionLabelKey,
  useSettingsUiStore,
  type IssueSection,
} from "@/store/settings-ui-store";
import { useEditorStore } from "@/store/editor-store";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { clearPicker } from "@/sidepanel/picker-control";
import {
  connectedPlatforms,
  jiraSiteId,
  pickInitialPlatform,
  useSettingsStore,
} from "@/store/settings-store";
import type { NormalizedSubmitResult, PlatformId } from "@/types/platform";
import { sendBg, type JiraSubmitResult } from "@/types/messages";
import { submitToGithub } from "@/sidepanel/lib/submitToGithub";
import { submitToLinear } from "@/sidepanel/lib/submitToLinear";
import { submitToNotion } from "@/sidepanel/lib/submitToNotion";
import type { NotionDatabaseSchema } from "@/types/notion";
import { usePlatformFields } from "@/sidepanel/hooks/usePlatformFields";
import { extractNotionPageId } from "@/lib/notion-page-id";
import { DocSectionBody } from "@/sidepanel/components/DocSectionBody";
import { LogAttachmentCards } from "@/sidepanel/components/LogAttachmentCards";
import { NetworkLogPreviewDialog } from "@/sidepanel/components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "@/sidepanel/components/ConsoleLogPreviewDialog";
import { ActionLogPreviewDialog } from "@/sidepanel/components/ActionLogPreviewDialog";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "@/sidepanel/components/StyleChangesTable";
import { buildAiMetaAttachment } from "@/sidepanel/lib/buildAiMetaAttachment";
import { buildCaptureFiles, type CaptureFiles } from "@/sidepanel/lib/buildCaptureFiles";
import { supportsConsoleNetworkLog, supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { annotateAttachmentDimensions } from "@/sidepanel/lib/attachmentDimensions";
import type { JiraAttachmentInput } from "@/types/jira";
import { buildIssueAdf } from "@/sidepanel/lib/buildIssueAdf";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { filterEnvironmentRows, parseChromeVersion } from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import { extractInlineRefs, resolveInlineImagesForSections } from "@/sidepanel/lib/resolveInlineImages";
import { SubmitFieldsDialog } from "@/sidepanel/tabs/SubmitFieldsDialog";

type SubmitFields = {
  issueTypeId?: string;
  assigneeId?: string;
  assigneeName?: string;
  priorityId?: string;
  priorityName?: string;
  parentKey?: string;
  parentLabel?: string;
  relatesKey?: string;
  relatesLabel?: string;
};

export function DraftDetailDialog({
  issue,
  open,
  onOpenChange,
  onSubmitSuccess,
}: {
  issue: IssueRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitSuccess?: (result: NormalizedSubmitResult) => void;
}) {
  const t = useT();
  const accounts = useSettingsStore((s) => s.accounts);
  const jiraAccount = accounts.jira;
  const ghAccount = accounts.github;
  const linearAccount = accounts.linear;
  const notionAccount = accounts.notion;
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const sectionConfig = useSettingsUiStore((s) => s.issueSections);

  const [fields, setFields] = useState<SubmitFields>({});
  const [submitOpen, setSubmitOpen] = useState(false);

  const lastJiraSubmit = useSettingsStore((s) => s.lastSubmitFields.jira);
  const lastGhSubmit = useSettingsStore((s) => s.lastSubmitFields.github);
  const lastLinearSubmit = useSettingsStore((s) => s.lastSubmitFields.linear);
  const lastNotionSubmit = useSettingsStore((s) => s.lastSubmitFields.notion);
  const lastSubmittedPlatform = useSettingsStore((s) => s.lastSubmittedPlatform);

  const available = useMemo(() => connectedPlatforms(accounts), [accounts]);
  const initialPlatform = useMemo(
    () => pickInitialPlatform(accounts, lastSubmittedPlatform),
    [accounts, lastSubmittedPlatform],
  );
  const [platform, setPlatform] = useState<PlatformId>(initialPlatform ?? "jira");
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
    resetKey: issue?.id,
  });
  const [notionSchema, setNotionSchema] = useState<NotionDatabaseSchema | null>(null);

  // 다이얼로그 진입 prefill — open / issue.id 변경 시에만 동작.
  // 사용자가 SubmitFieldsDialog의 Tab으로 platform을 바꾸면 patchIssue로 issue.platform이
  // 갱신되는데, 그걸 deps에 넣으면 이 effect가 재실행되어 setSubmitOpen(false)/setPlatform(initial)이
  // 사용자 인터랙션을 덮어쓴다 (Tab 전환 시 SubmitFieldsDialog가 강제로 닫히는 버그). 그래서 의도적으로 제외.
  useEffect(() => {
    if (!open) return;
    const base: SubmitFields = { issueTypeId: jiraAccount?.issueTypeId };
    if (
      lastJiraSubmit?.projectKey &&
      lastJiraSubmit.projectKey === jiraAccount?.projectKey
    ) {
      const { projectKey: _, ...restored } = lastJiraSubmit;
      Object.assign(base, restored);
    }
    setFields(base);
    const initial =
      issue && accounts[issue.platform]
        ? issue.platform
        : pickInitialPlatform(accounts, lastSubmittedPlatform) ?? "jira";
    setPlatform(initial);
    setSubmitOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, issue?.id]);

  function handlePlatformChange(p: PlatformId) {
    setPlatform(p);
    if (issue && issue.platform !== p) patchIssue(issue.id, { platform: p });
  }

  const isScreenshot = issue?.captureMode === "screenshot";
  const isVideo = issue?.captureMode === "video";
  const isFreeform = issue?.captureMode === "freeform";
  const { beforeUrl, afterUrl } = useIssueImages(issue?.id ?? null, issue?.snapshot);

  const [networkLogData, setNetworkLogData] = useState<NetworkLog | null>(null);
  const [consoleLogData, setConsoleLogData] = useState<ConsoleLog | null>(null);
  const [actionLogData, setActionLogData] = useState<ActionLog | null>(null);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [consoleDialogOpen, setConsoleDialogOpen] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  useEffect(() => {
    if (!open || !supportsConsoleNetworkLog(issue?.captureMode)) {
      setNetworkLogData(null);
      setConsoleLogData(null);
      setActionLogData(null);
      return;
    }
    let cancelled = false;
    if (issue?.networkLogBlobKey) {
      getNetworkLog(issue.networkLogBlobKey).then((log) => {
        if (!cancelled) setNetworkLogData(log);
      });
    }
    if (issue?.consoleLogBlobKey) {
      getConsoleLog(issue.consoleLogBlobKey).then((log) => {
        if (!cancelled) setConsoleLogData(log);
      });
    }
    if (supportsActionLog(issue?.captureMode) && issue?.actionLogBlobKey) {
      getActionLog(issue.actionLogBlobKey).then((log) => {
        if (!cancelled) setActionLogData(log);
      });
    }
    return () => { cancelled = true; };
  }, [open, issue?.captureMode, issue?.networkLogBlobKey, issue?.consoleLogBlobKey, issue?.actionLogBlobKey]);

  const diffs = useMemo(() => {
    if (!issue?.selectionSnapshot || !issue.styleEdits) return [];
    return buildStyleDiff(
      {
        classList: issue.selectionSnapshot.classList,
        specifiedStyles: issue.selectionSnapshot.specifiedStyles,
        computedStyles: issue.selectionSnapshot.computedStyles,
        text: issue.selectionSnapshot.text,
      },
      {
        classList: issue.styleEdits.classList,
        inlineStyle: issue.styleEdits.inlineStyle,
        text: issue.styleEdits.text,
      },
    );
  }, [issue]);

  if (!issue) return null;

  const hasStyleBlock =
    !isScreenshot &&
    (!!issue.snapshot.before || !!issue.snapshot.after || diffs.length > 0);
  const hasScreenshot = isScreenshot && !!issue.snapshot.before;

  async function buildCtxForSubmit() {
    if (!issue) throw new Error(t("create.requiredMissing"));
    const sel = issue.selectionSnapshot;
    let networkLog: NetworkLog | null = null;
    if (supportsConsoleNetworkLog(issue.captureMode) && issue.networkLogBlobKey) {
      networkLog = await getNetworkLog(issue.networkLogBlobKey);
    }
    let consoleLogForSubmit: ConsoleLog | null = null;
    if (supportsConsoleNetworkLog(issue.captureMode) && issue.consoleLogBlobKey) {
      consoleLogForSubmit = await getConsoleLog(issue.consoleLogBlobKey);
    }
    let actionLogForSubmit: ActionLog | null = null;
    if (supportsActionLog(issue.captureMode) && issue.actionLogBlobKey) {
      actionLogForSubmit = await getActionLog(issue.actionLogBlobKey);
    }
    const ctx = {
      os: getOsInfo(),
      browser: parseChromeVersion(navigator.userAgent),
      captureMode: issue.captureMode,
      title: issue.draft.title,
      sections: issue.draft.sections,
      sectionConfig,
      url: issue.pageUrl,
      selector: issue.selector ?? "",
      tagName: issue.tagName ?? "",
      classListBefore: sel?.classList ?? [],
      classListAfter: issue.styleEdits?.classList ?? [],
      specifiedStyles: sel?.specifiedStyles ?? {},
      tokens: issue.tokensSnapshot ?? [],
      viewport: isFreeform ? (issue.viewport ?? null) : (issue.viewport ?? sel?.viewport ?? { width: 0, height: 0 }),
      capturedAt: sel?.capturedAt ?? issue.createdAt,
      diffs,
      environment: issue.draft.environment ?? [],
      networkLogSummary: networkLog ? buildNetworkLogSummary(networkLog) : undefined,
      consoleLogSummary: consoleLogForSubmit ? buildConsoleLogSummary(consoleLogForSubmit) : undefined,
    };

    const videoBlob = isVideo ? await getVideoBlob(issue.id) : null;
    const beforeBlob = issue.snapshot.before ? await getImageBlob(issue.id, "before") : null;
    const afterBlob = !isScreenshot && issue.snapshot.after
      ? await getImageBlob(issue.id, "after")
      : null;
    const beforeDataUrl = beforeBlob ? await blobToDataUrl(beforeBlob) : null;
    const afterDataUrl = afterBlob ? await blobToDataUrl(afterBlob) : null;
    const noDiffs = diffs.length === 0;
    const isElementNoDiff = !isScreenshot && !isVideo && !isFreeform && noDiffs;
    const captureFiles = await buildCaptureFiles({
      captureMode: isElementNoDiff ? "screenshot" : (issue.captureMode ?? "element"),
      videoBlob,
      screenshotImage: isScreenshot || isElementNoDiff ? beforeDataUrl : null,
      beforeImage: isScreenshot || isElementNoDiff ? null : beforeDataUrl,
      afterImage: isElementNoDiff ? null : afterDataUrl,
      networkLog,
      consoleLog: consoleLogForSubmit,
      actionLog: actionLogForSubmit,
      // 영상 동기화 앵커. videoThumbnail은 IssueRecord 미영속 → 저장 draft logs.html은 poster 생략.
      videoStartedAt: issue.videoStartedAt,
      videoEndedAt: issue.videoEndedAt,
      pageUrl: issue.pageUrl,
      issueTitle: issue.title?.trim() || undefined,
    });
    return { ctx, captureFiles };
  }

  async function handleJiraSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!jiraAccount?.auth || !jiraAccount.projectKey) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
    }
    if (!fields.issueTypeId) throw new Error(t("create.requiredMissing"));

    const rawAttachments: JiraAttachmentInput[] = [
      buildAiMetaAttachment(ctx),
      ...captureFiles.images,
      ...(captureFiles.video ? [captureFiles.video] : []),
      ...captureFiles.logs,
    ];
    const jiraInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    for (const img of jiraInline) {
      rawAttachments.push({ filename: `inline-${img.refId}.webp`, dataUrl: img.dataUrl });
    }
    const attachments = await annotateAttachmentDimensions(rawAttachments);

    const result = await sendBg<JiraSubmitResult>({
      type: "jira.submitIssue",
      payload: {
        projectKey: jiraAccount.projectKey,
        summary: issue.draft.title.trim(),
        description: buildIssueAdf(ctx, jiraInline.map((i) => i.refId)),
        issueTypeId: fields.issueTypeId,
        assigneeAccountId: fields.assigneeId,
        priorityId: fields.priorityId,
        parentKey: fields.parentKey,
      },
      attachments,
      relatesKey: fields.relatesKey,
    });
    markSubmitted(issue.id, {
      platform: "jira",
      key: result.key,
      url: result.url,
      jiraSiteId: jiraSiteId(jiraAccount.auth),
      issueTypeName: jiraAccount.issueTypeName,
      priorityName: fields.priorityName,
      assigneeName: fields.assigneeName,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("jira", {
      projectKey: jiraAccount.projectKey,
      assigneeId: fields.assigneeId,
      assigneeName: fields.assigneeName,
      priorityId: fields.priorityId,
      priorityName: fields.priorityName,
      parentKey: fields.parentKey,
      parentLabel: fields.parentLabel,
      relatesKey: fields.relatesKey,
      relatesLabel: fields.relatesLabel,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("jira");
    return { key: result.key, url: result.url };
  }

  async function handleGithubSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!ghAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.github") }));
    }
    if (!ghFields.owner || !ghFields.repo) throw new Error(t("create.requiredMissing"));

    const ghInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToGithub({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      inlineImages: ghInline,
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignee: ghFields.assignee,
    });
    markSubmitted(issue.id, {
      platform: "github",
      key: result.key,
      url: result.url,
      githubOwner: ghFields.owner,
      githubRepo: ghFields.repo,
      githubLabels: ghFields.label ? [ghFields.label] : undefined,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("github", {
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignee: ghFields.assignee,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("github");
    return result;
  }

  async function handleLinearSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!linearAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.linear") }));
    }
    if (!linearFields.teamId) throw new Error(t("create.requiredMissing"));

    const linearInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToLinear({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      inlineImages: linearInline,
      teamId: linearFields.teamId,
      projectId: linearFields.projectId,
      labelId: linearFields.labelId,
      assigneeId: linearFields.assigneeId,
      priority: linearFields.priority,
    });
    markSubmitted(issue.id, {
      platform: "linear",
      key: result.key,
      url: result.url,
      linearIdentifier: result.key,
      linearTeamKey: linearFields.teamKey,
      linearLabelName: linearFields.labelName,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
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
    return result;
  }

  async function handleNotionSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!notionAccount) {
      throw new Error(
        t("platform.notConnected.title", { platform: t("platform.tab.notion") }),
      );
    }
    if (!notionFields.databaseId || !notionSchema) {
      throw new Error(t("create.requiredMissing"));
    }

    const notionInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToNotion({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      inlineImages: notionInline,
      databaseId: notionFields.databaseId,
      titlePropertyName: notionSchema.titlePropertyName,
      statusOption:
        notionFields.statusOption && notionSchema.statusProperty
          ? {
              propertyName: notionSchema.statusProperty.name,
              optionName: notionFields.statusOption,
            }
          : undefined,
      selectValues: notionFields.selectValues,
    });
    const pageId = extractNotionPageId(result.url);
    markSubmitted(issue.id, {
      platform: "notion",
      key: result.key,
      url: result.url,
      notionPageId: pageId ?? undefined,
      notionDatabaseId: notionFields.databaseId,
      notionDatabaseTitle: notionFields.databaseTitle,
      notionStatusOption: notionFields.statusOption,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("notion", {
      databaseId: notionFields.databaseId,
      databaseTitle: notionFields.databaseTitle,
      statusOption: notionFields.statusOption,
      selectValues: notionFields.selectValues,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("notion");
    return result;
  }

  async function handleSubmit(submitPlatform: PlatformId): Promise<NormalizedSubmitResult> {
    const { ctx, captureFiles } = await buildCtxForSubmit();
    let result: NormalizedSubmitResult;
    if (submitPlatform === "github") result = await handleGithubSubmit(ctx, captureFiles);
    else if (submitPlatform === "linear") result = await handleLinearSubmit(ctx, captureFiles);
    else if (submitPlatform === "notion") result = await handleNotionSubmit(ctx, captureFiles);
    else result = await handleJiraSubmit(ctx, captureFiles);
    if (issue) {
      const activeRefs = extractInlineRefs(
        Object.values(issue.draft.sections).join("\n"),
      );
      void pruneOrphanInlineImages(activeRefs);
    }
    return result;
  }

  function handleDelete() {
    if (!issue) return;
    removeIssue(issue.id);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
              <DialogHeader>
                <DialogTitle className="text-xl">{t("draftDetail.title")}</DialogTitle>
              </DialogHeader>

              <Card className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain bg-background p-4">
                <FieldSection label={t("section.issueTitle")}>
                  {issue.draft.title ? (
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {issue.draft.title}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground/70">{t("common.empty")}</p>
                  )}
                </FieldSection>

                <FieldSection label={t("section.env")}>
                  <EnvBlock issue={issue} />
                </FieldSection>

                <DraftDetailSections
                  issue={issue}
                  sectionConfig={sectionConfig}
                  beforeUrl={beforeUrl}
                  afterUrl={afterUrl}
                  diffs={diffs}
                  isVideo={isVideo}
                  hasScreenshot={hasScreenshot}
                  hasStyleBlock={hasStyleBlock}
                  networkLogData={networkLogData}
                  consoleLogData={consoleLogData}
                  actionLogData={actionLogData}
                  onNetworkLogClick={() => setNetworkDialogOpen(true)}
                  onConsoleLogClick={() => setConsoleDialogOpen(true)}
                  onActionLogClick={() => setActionDialogOpen(true)}
                />
              </Card>

              {available.length === 0 ? (
                <Alert variant="default">
                  <Info className="h-4 w-4" />
                  <AlertTitle>{t("platform.empty.title")}</AlertTitle>
                  <AlertDescription>{t("platform.empty.body")}</AlertDescription>
                </Alert>
              ) : null}

              <DialogFooter className="!flex-row items-center !justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                    >
                      {t("issueList.deleteIssue")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("issueList.deleteDraft.title")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("issueList.deleteDraft.body")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>
                        {t("issueList.deleteIssue")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    {t("common.close")}
                  </Button>
                  <Button
                    disabled={available.length === 0}
                    onClick={() => setSubmitOpen(true)}
                  >
                    {t("issue.submit")}
                  </Button>
                </div>
              </DialogFooter>
        </DialogContent>
      </Dialog>

      {networkLogData && (
        <NetworkLogPreviewDialog
          open={networkDialogOpen}
          onOpenChange={setNetworkDialogOpen}
          requests={networkLogData.requests}
        />
      )}
      {consoleLogData && (
        <ConsoleLogPreviewDialog
          open={consoleDialogOpen}
          onOpenChange={setConsoleDialogOpen}
          entries={consoleLogData.entries}
          startedAt={consoleLogData.startedAt}
        />
      )}
      {actionLogData && (
        <ActionLogPreviewDialog
          open={actionDialogOpen}
          onOpenChange={setActionDialogOpen}
          entries={actionLogData.entries}
          startedAt={actionLogData.startedAt}
        />
      )}
      <SubmitFieldsDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title={t("issue.submit")}
        platform={platform}
        setPlatform={handlePlatformChange}
        availablePlatforms={available}
        jiraFields={fields}
        setJiraFields={(patch) => setFields((f) => ({ ...f, ...patch }))}
        ghFields={ghFields}
        setGhFields={setGhFields}
        linearFields={linearFields}
        setLinearFields={setLinearFields}
        notionFields={notionFields}
        setNotionFields={setNotionFields}
        onNotionSchemaResolved={setNotionSchema}
        onSubmit={handleSubmit}
        onSuccess={(result) => {
          onOpenChange(false);
          onSubmitSuccess?.(result);
        }}
      />
    </>
  );
}

function FieldSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-base font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function DraftDetailSections({
  issue,
  sectionConfig,
  beforeUrl,
  afterUrl,
  diffs,
  isVideo,
  hasScreenshot,
  hasStyleBlock,
  networkLogData,
  consoleLogData,
  actionLogData,
  onNetworkLogClick,
  onConsoleLogClick,
  onActionLogClick,
}: {
  issue: IssueRecord;
  sectionConfig: IssueSection[];
  beforeUrl: string | null;
  afterUrl: string | null;
  diffs: ReturnType<typeof buildStyleDiff>;
  isVideo: boolean;
  hasScreenshot: boolean;
  hasStyleBlock: boolean;
  networkLogData: NetworkLog | null;
  consoleLogData: ConsoleLog | null;
  actionLogData: ActionLog | null;
  onNetworkLogClick: () => void;
  onConsoleLogClick: () => void;
  onActionLogClick: () => void;
}) {
  const t = useT();
  const enabled = sectionConfig.filter((s) => s.enabled);
  const out: React.ReactNode[] = [];
  let mediaInserted = false;

  const mediaBlock =
    isVideo && issue.snapshot.before ? (
      <FieldSection key="__media" label={t("section.media")}>
        <DraftVideoPreview issue={issue} thumbnailUrl={beforeUrl} />
      </FieldSection>
    ) : hasScreenshot && beforeUrl ? (
      <FieldSection key="__media" label={t("section.media")}>
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted/70">
          <img
            src={beforeUrl}
            alt={t("alt.capturedImage")}
            className="h-full w-full object-contain"
          />
        </div>
      </FieldSection>
    ) : hasStyleBlock && diffs.length > 0 ? (
      <FieldSection key="__media" label={t("section.styleChanges")}>
        <StyleChangesTable
          beforeImage={beforeUrl}
          afterImage={afterUrl}
          diffs={diffs}
        />
      </FieldSection>
    ) : hasStyleBlock ? (
      <FieldSection key="__media" label={t("section.media")}>
        {beforeUrl ? (
          <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted/70">
            <img src={beforeUrl} alt={t("section.media")} className="h-full w-full object-contain" />
          </div>
        ) : null}
      </FieldSection>
    ) : null;

  const showActionCard = supportsActionLog(issue.captureMode) && actionLogData !== null && actionLogData.captured > 0;
  const showLogCards = supportsConsoleNetworkLog(issue.captureMode) && (
    (networkLogData !== null && networkLogData.captured > 0) ||
    (consoleLogData !== null && consoleLogData.captured > 0) ||
    showActionCard
  );
  const logCardsBlock = showLogCards ? (
    <FieldSection key="__logCards" label={t("section.logs")}>
      <LogAttachmentCards
        networkLog={networkLogData}
        networkLogAttach={!!issue.networkLogBlobKey}
        onNetworkLogToggle={() => {}}
        onNetworkLogClick={onNetworkLogClick}
        consoleLog={consoleLogData}
        consoleLogAttach={!!issue.consoleLogBlobKey}
        onConsoleLogToggle={() => {}}
        onConsoleLogClick={onConsoleLogClick}
        actionLog={showActionCard ? actionLogData : null}
        onActionLogClick={onActionLogClick}
        readOnly
      />
    </FieldSection>
  ) : null;

  for (const sec of enabled) {
    const value = issue.draft.sections[sec.id] ?? "";
    if (POST_MEDIA_SECTION_IDS.has(sec.id) && !mediaInserted) {
      mediaInserted = true;
      if (mediaBlock) out.push(mediaBlock);
      if (logCardsBlock) out.push(logCardsBlock);
    }
    if (!value.trim()) continue;
    const label = sec.labelOverride?.trim() || t(sectionLabelKey(sec.id));
    out.push(
      <FieldSection key={sec.id} label={label}>
        <DocSectionBody section={sec} value={value} />
      </FieldSection>,
    );
  }
  if (!mediaInserted) {
    if (mediaBlock) out.push(mediaBlock);
    if (logCardsBlock) out.push(logCardsBlock);
  }
  return <>{out}</>;
}

function EnvBlock({ issue }: { issue: IssueRecord }) {
  const os = getOsInfo();
  const browser = parseChromeVersion(navigator.userAgent);
  const rows: { label: string; value: string }[] = [
    ...(os ? [{ label: "OS", value: os }] : []),
    ...(browser ? [{ label: "Browser", value: browser }] : []),
    { label: "Page", value: issue.pageUrl || "-" },
    ...(issue.captureMode !== "video" && issue.captureMode !== "freeform" && issue.tagName
      ? [
          {
            label: "DOM",
            value: formatElementName({
              tag: issue.tagName,
              classList: issue.selectionSnapshot?.classList ?? [],
            }),
          },
        ]
      : []),
  ];
  const vp = issue.viewport ?? issue.selectionSnapshot?.viewport;
  if (vp) {
    rows.push({ label: "Viewport", value: `${vp.width}×${vp.height}` });
  }
  rows.push({
    label: "Captured",
    value: new Date(issue.createdAt).toLocaleString(dateBcp47(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
  rows.push(...filterEnvironmentRows(issue.draft.environment ?? []));

  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex gap-3">
          <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
          <span className="break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function DraftVideoPreview({ issue, thumbnailUrl }: { issue: IssueRecord; thumbnailUrl: string | null }) {
  const editorBlob = useEditorStore(
    (s) => s.currentIssueId === issue.id ? s.videoBlob : null,
  );
  const [dbBlob, setDbBlob] = useState<Blob | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (editorBlob) return;
    let cancelled = false;
    getVideoBlob(issue.id).then((b) => {
      if (!cancelled) setDbBlob(b);
    });
    return () => { cancelled = true; };
  }, [issue.id, editorBlob]);

  const blob = editorBlob ?? dbBlob;

  useEffect(() => {
    if (!blob) { setSrc(null); return; }
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <div className="space-y-1.5">
      {src ? (
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
          <video src={src} controls className="h-full w-full object-contain" />
        </div>
      ) : thumbnailUrl ? (
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
          <img src={thumbnailUrl} alt="Recording thumbnail" className="h-full w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}
