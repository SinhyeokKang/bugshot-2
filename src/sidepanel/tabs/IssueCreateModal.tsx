import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { blobToDataUrl, pruneOrphanInlineImages } from "@/store/blob-db";
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
import { buildHar, serializeHar } from "@/sidepanel/lib/buildHar";
import { buildConsoleLogJson, serializeConsoleLog } from "@/sidepanel/lib/buildConsoleLogJson";
import {
  buildNetworkLogSummary,
  buildConsoleLogSummary,
} from "@/sidepanel/lib/buildLogSummary";
import type { MarkdownContext } from "@/sidepanel/lib/buildIssueMarkdown";
import type { NormalizedSubmitResult } from "@/types/platform";
import { submitToGithub, type GithubFileInput } from "@/sidepanel/lib/submitToGithub";
import { submitToLinear, type LinearFileInput } from "@/sidepanel/lib/submitToLinear";
import { submitToNotion, type NotionFileInput } from "@/sidepanel/lib/submitToNotion";
import { recordingFilename } from "@/sidepanel/lib/video-mime";
import { extractInlineRefs, resolveInlineImagesForSections, type InlineImageInput } from "@/sidepanel/lib/resolveInlineImages";
import {
  initialGhFields,
  type GithubIssueFieldsValue,
} from "./githubFields/GithubIssueFields";
import {
  initialLinearFields,
  type LinearIssueFieldsValue,
} from "./linearFields/LinearIssueFields";
import {
  initialNotionFields,
  type NotionIssueFieldsValue,
} from "./notionFields/NotionIssueFields";
import type { NotionDatabaseSchema } from "@/types/notion";
import { extractNotionPageId } from "@/lib/notion-page-id";
import { SubmitFieldsDialog } from "./SubmitFieldsDialog";

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

  // GitHub 메타 필드: 직전 제출값 우선, 없으면 account.defaults, 그것도 없으면 빈 값
  const [ghFields, setGhFieldsState] = useState<GithubIssueFieldsValue>(() =>
    initialGhFields(lastGhSubmit, ghAccount?.defaults),
  );
  useEffect(() => {
    if (open) setGhFieldsState(initialGhFields(lastGhSubmit, ghAccount?.defaults));
  }, [open, lastGhSubmit, ghAccount?.defaults]);
  const setGhFields = useCallback(
    (patch: Partial<GithubIssueFieldsValue>) =>
      setGhFieldsState((s) => ({ ...s, ...patch })),
    [],
  );

  const [linearFields, setLinearFieldsState] = useState<LinearIssueFieldsValue>(() =>
    initialLinearFields(lastLinearSubmit, linearAccount?.defaults),
  );
  useEffect(() => {
    if (open) setLinearFieldsState(initialLinearFields(lastLinearSubmit, linearAccount?.defaults));
  }, [open, lastLinearSubmit, linearAccount?.defaults]);
  const setLinearFields = useCallback(
    (patch: Partial<LinearIssueFieldsValue>) =>
      setLinearFieldsState((s) => ({ ...s, ...patch })),
    [],
  );

  const [notionFields, setNotionFieldsState] = useState<NotionIssueFieldsValue>(() =>
    initialNotionFields(lastNotionSubmit, notionAccount?.defaults),
  );
  useEffect(() => {
    if (open) setNotionFieldsState(initialNotionFields(lastNotionSubmit, notionAccount?.defaults));
  }, [open, lastNotionSubmit, notionAccount?.defaults]);
  const setNotionFields = useCallback(
    (patch: Partial<NotionIssueFieldsValue>) =>
      setNotionFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
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
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const draft = useEditorStore((s) => s.draft);
  const issueFields = useEditorStore((s) => s.issueFields);
  const setIssueFields = useEditorStore((s) => s.setIssueFields);
  const onSubmitted = useEditorStore((s) => s.onSubmitted);
  const networkLog = useEditorStore((s) => s.networkLog);
  const networkLogAttach = useEditorStore((s) => s.networkLogAttach);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const consoleLogAttach = useEditorStore((s) => s.consoleLogAttach);
  const sectionConfig = useSettingsUiStore((s) => s.issueSections);

  const currentIssueId = useEditorStore((s) => s.currentIssueId);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);
  const patchIssue = useIssuesStore((s) => s.patchIssue);

  function buildCtx(): MarkdownContext {
    if (!draft || !target) throw new Error(t("create.requiredMissing"));
    if (captureMode === "freeform") {
      const hasNetworkLog = networkLogAttach && networkLog && networkLog.captured > 0;
      const hasConsoleLog = consoleLogAttach && consoleLog && consoleLog.captured > 0;
      const { freeformViewport, freeformCapturedAt } = useEditorStore.getState();
      return {
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

  async function handleJiraSubmit(ctx: MarkdownContext, inlineImages: InlineImageInput[]): Promise<NormalizedSubmitResult> {
    if (!jiraAccount?.auth || !jiraAccount.projectKey) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
    }
    if (!issueFields.issueTypeId) throw new Error(t("create.requiredMissing"));
    const description: AdfDoc = buildIssueAdf(ctx, inlineImages.map((i) => i.refId));
    const attachments: { filename: string; dataUrl: string }[] = [buildAiMetaAttachment(ctx)];

    if (captureMode === "freeform") {
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        attachments.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        attachments.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "video") {
      if (videoBlob) {
        attachments.push({ filename: recordingFilename(videoBlob.type), dataUrl: await blobToDataUrl(videoBlob) });
      }
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        attachments.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        attachments.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "screenshot") {
      const screenshotImage = screenshotAnnotated ?? screenshotRaw;
      if (screenshotImage) attachments.push({ filename: "screenshot.webp", dataUrl: screenshotImage });
    } else {
      if (beforeImage) attachments.push({ filename: "before.webp", dataUrl: beforeImage });
      if (afterImage) attachments.push({ filename: "after.webp", dataUrl: afterImage });
    }
    for (const img of inlineImages) {
      attachments.push({ filename: `inline-${img.refId}.webp`, dataUrl: img.dataUrl });
    }

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

  async function handleGithubSubmit(ctx: MarkdownContext, inlineImages: InlineImageInput[]): Promise<NormalizedSubmitResult> {
    if (!ghAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.github") }));
    }
    if (!ghFields.owner || !ghFields.repo) throw new Error(t("create.requiredMissing"));

    const images: GithubFileInput[] = [];
    let video: GithubFileInput | undefined;
    const logs: GithubFileInput[] = [];

    if (captureMode === "freeform") {
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "video") {
      if (videoBlob) video = { filename: recordingFilename(videoBlob.type), dataUrl: await blobToDataUrl(videoBlob) };
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "screenshot") {
      const screenshotImage = screenshotAnnotated ?? screenshotRaw;
      if (screenshotImage) images.push({ filename: "screenshot.webp", dataUrl: screenshotImage });
    } else {
      if (beforeImage) images.push({ filename: "before.webp", dataUrl: beforeImage });
      if (afterImage) images.push({ filename: "after.webp", dataUrl: afterImage });
    }

    const result = await submitToGithub({
      ctx,
      images,
      video,
      logs,
      inlineImages,
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignees: ghFields.assignees,
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
      assignees: ghFields.assignees,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("github");
    onSubmitted({ key: result.key, url: result.url });
    return result;
  }

  async function handleLinearSubmit(ctx: MarkdownContext, inlineImages: InlineImageInput[]): Promise<NormalizedSubmitResult> {
    if (!linearAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.linear") }));
    }
    if (!linearFields.teamId) throw new Error(t("create.requiredMissing"));

    const images: LinearFileInput[] = [];
    let video: LinearFileInput | undefined;
    const logs: LinearFileInput[] = [];

    if (captureMode === "freeform") {
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "video") {
      if (videoBlob) video = { filename: recordingFilename(videoBlob.type), dataUrl: await blobToDataUrl(videoBlob) };
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "screenshot") {
      const screenshotImage = screenshotAnnotated ?? screenshotRaw;
      if (screenshotImage) images.push({ filename: "screenshot.webp", dataUrl: screenshotImage });
    } else {
      if (beforeImage) images.push({ filename: "before.webp", dataUrl: beforeImage });
      if (afterImage) images.push({ filename: "after.webp", dataUrl: afterImage });
    }

    const result = await submitToLinear({
      ctx,
      images,
      video,
      logs,
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

  async function handleNotionSubmit(ctx: MarkdownContext, inlineImages: InlineImageInput[]): Promise<NormalizedSubmitResult> {
    if (!notionAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.notion") }));
    }
    if (!notionFields.databaseId || !notionSchema) {
      throw new Error(t("create.requiredMissing"));
    }

    const images: NotionFileInput[] = [];
    let video: NotionFileInput | undefined;
    const logs: NotionFileInput[] = [];

    if (captureMode === "freeform") {
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "video") {
      if (videoBlob) video = { filename: recordingFilename(videoBlob.type), dataUrl: await blobToDataUrl(videoBlob) };
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (captureMode === "screenshot") {
      const screenshotImage = screenshotAnnotated ?? screenshotRaw;
      if (screenshotImage) images.push({ filename: "screenshot.webp", dataUrl: screenshotImage });
    } else {
      if (beforeImage) images.push({ filename: "before.webp", dataUrl: beforeImage });
      if (afterImage) images.push({ filename: "after.webp", dataUrl: afterImage });
    }
    const result = await submitToNotion({
      ctx,
      images,
      video,
      logs,
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
    let result: NormalizedSubmitResult;
    if (submitPlatform === "github") result = await handleGithubSubmit(ctx, inlineImages);
    else if (submitPlatform === "linear") result = await handleLinearSubmit(ctx, inlineImages);
    else if (submitPlatform === "notion") result = await handleNotionSubmit(ctx, inlineImages);
    else result = await handleJiraSubmit(ctx, inlineImages);
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
        onClick={() => setOpen(true)}
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
