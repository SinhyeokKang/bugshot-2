import { useCallback, useEffect, useMemo, useState } from "react";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import { getVideoBlob, getImageBlob, getNetworkLog, getConsoleLog, blobToDataUrl } from "@/store/blob-db";
import { useIssueImages } from "../hooks/useIssueImages";
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
import { clearPicker } from "../picker-control";
import {
  connectedPlatforms,
  jiraSiteId,
  pickInitialPlatform,
  useSettingsStore,
} from "@/store/settings-store";
import type { NormalizedSubmitResult, PlatformId } from "@/types/platform";
import { sendBg, type JiraSubmitResult } from "@/types/messages";
import { submitToGithub, type GithubFileInput } from "../lib/submitToGithub";
import { submitToLinear, type LinearFileInput } from "../lib/submitToLinear";
import { submitToNotion, type NotionFileInput } from "../lib/submitToNotion";
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
import { DocSectionBody } from "../components/DocSectionBody";
import { LogAttachmentCards } from "../components/LogAttachmentCards";
import { NetworkLogPreviewDialog } from "../components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "../components/ConsoleLogPreviewDialog";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "../components/StyleChangesTable";
import { buildAiMetaAttachment } from "../lib/buildAiMetaAttachment";
import { buildHar, serializeHar } from "../lib/buildHar";
import { buildConsoleLogJson, serializeConsoleLog } from "../lib/buildConsoleLogJson";
import { buildIssueAdf } from "../lib/buildIssueAdf";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "../lib/buildLogSummary";
import { SubmitFieldsDialog } from "./IssueCreateModal";

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
  const [ghFields, setGhFieldsState] = useState<GithubIssueFieldsValue>(() =>
    initialGhFields(lastGhSubmit, ghAccount?.defaults),
  );
  const setGhFields = useCallback(
    (patch: Partial<GithubIssueFieldsValue>) =>
      setGhFieldsState((s) => ({ ...s, ...patch })),
    [],
  );

  const [linearFields, setLinearFieldsState] = useState<LinearIssueFieldsValue>(() =>
    initialLinearFields(lastLinearSubmit, linearAccount?.defaults),
  );
  const setLinearFields = useCallback(
    (patch: Partial<LinearIssueFieldsValue>) =>
      setLinearFieldsState((s) => ({ ...s, ...patch })),
    [],
  );

  const [notionFields, setNotionFieldsState] = useState<NotionIssueFieldsValue>(() =>
    initialNotionFields(lastNotionSubmit, notionAccount?.defaults),
  );
  const setNotionFields = useCallback(
    (patch: Partial<NotionIssueFieldsValue>) =>
      setNotionFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
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
    setGhFieldsState(initialGhFields(lastGhSubmit, ghAccount?.defaults));
    setLinearFieldsState(initialLinearFields(lastLinearSubmit, linearAccount?.defaults));
    setNotionFieldsState(initialNotionFields(lastNotionSubmit, notionAccount?.defaults));
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
  const { beforeUrl, afterUrl } = useIssueImages(issue?.id ?? null, issue?.snapshot);

  const [networkLogData, setNetworkLogData] = useState<NetworkLog | null>(null);
  const [consoleLogData, setConsoleLogData] = useState<ConsoleLog | null>(null);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [consoleDialogOpen, setConsoleDialogOpen] = useState(false);
  useEffect(() => {
    if (!open || !isVideo) {
      setNetworkLogData(null);
      setConsoleLogData(null);
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
    return () => { cancelled = true; };
  }, [open, isVideo, issue?.networkLogBlobKey, issue?.consoleLogBlobKey]);

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
    if (isVideo && issue.networkLogBlobKey) {
      networkLog = await getNetworkLog(issue.networkLogBlobKey);
    }
    let consoleLogForSubmit: ConsoleLog | null = null;
    if (isVideo && issue.consoleLogBlobKey) {
      consoleLogForSubmit = await getConsoleLog(issue.consoleLogBlobKey);
    }
    const ctx = {
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
      viewport: issue.viewport ?? sel?.viewport ?? { width: 0, height: 0 },
      capturedAt: sel?.capturedAt ?? issue.createdAt,
      diffs,
      networkLogSummary: networkLog ? buildNetworkLogSummary(networkLog) : undefined,
      consoleLogSummary: consoleLogForSubmit ? buildConsoleLogSummary(consoleLogForSubmit) : undefined,
    };
    return { ctx, networkLog, consoleLog: consoleLogForSubmit };
  }

  async function handleJiraSubmit(): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!jiraAccount?.auth || !jiraAccount.projectKey) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
    }
    if (!fields.issueTypeId) throw new Error(t("create.requiredMissing"));

    const { ctx, networkLog, consoleLog: consoleLogForSubmit } = await buildCtxForSubmit();
    const description = buildIssueAdf(ctx);
    const attachments: { filename: string; dataUrl: string }[] = [
      buildAiMetaAttachment(ctx),
    ];
    if (isVideo) {
      const blob = await getVideoBlob(issue.id);
      if (blob) {
        attachments.push({ filename: "recording.webm", dataUrl: await blobToDataUrl(blob) });
      }
      if (networkLog) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        attachments.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLogForSubmit) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLogForSubmit))], { type: "application/json" });
        attachments.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (isScreenshot) {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) attachments.push({ filename: "screenshot.webp", dataUrl: await blobToDataUrl(blob) });
      }
    } else {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) attachments.push({ filename: "before.webp", dataUrl: await blobToDataUrl(blob) });
      }
      if (issue.snapshot.after) {
        const blob = await getImageBlob(issue.id, "after");
        if (blob) attachments.push({ filename: "after.webp", dataUrl: await blobToDataUrl(blob) });
      }
    }

    const result = await sendBg<JiraSubmitResult>({
      type: "jira.submitIssue",
      payload: {
        projectKey: jiraAccount.projectKey,
        summary: issue.draft.title.trim(),
        description,
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

  async function handleGithubSubmit(): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!ghAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.github") }));
    }
    if (!ghFields.owner || !ghFields.repo) throw new Error(t("create.requiredMissing"));

    const { ctx, networkLog, consoleLog: consoleLogForSubmit } = await buildCtxForSubmit();
    const images: GithubFileInput[] = [];
    let video: GithubFileInput | undefined;
    const logs: GithubFileInput[] = [];

    if (isVideo) {
      const blob = await getVideoBlob(issue.id);
      if (blob) video = { filename: "recording.webm", dataUrl: await blobToDataUrl(blob) };
      if (networkLog) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLogForSubmit) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLogForSubmit))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (isScreenshot) {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) images.push({ filename: "screenshot.webp", dataUrl: await blobToDataUrl(blob) });
      }
    } else {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) images.push({ filename: "before.webp", dataUrl: await blobToDataUrl(blob) });
      }
      if (issue.snapshot.after) {
        const blob = await getImageBlob(issue.id, "after");
        if (blob) images.push({ filename: "after.webp", dataUrl: await blobToDataUrl(blob) });
      }
    }

    const result = await submitToGithub({
      ctx,
      images,
      video,
      logs,
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignees: ghFields.assignees,
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
      assignees: ghFields.assignees,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("github");
    return result;
  }

  async function handleLinearSubmit(): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!linearAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.linear") }));
    }
    if (!linearFields.teamId) throw new Error(t("create.requiredMissing"));

    const { ctx, networkLog: netLog, consoleLog: conLog } = await buildCtxForSubmit();
    const images: LinearFileInput[] = [];
    let video: LinearFileInput | undefined;
    const logs: LinearFileInput[] = [];

    if (isVideo) {
      const blob = await getVideoBlob(issue.id);
      if (blob) video = { filename: "recording.webm", dataUrl: await blobToDataUrl(blob) };
      if (netLog) {
        const harBlob = new Blob([serializeHar(buildHar(netLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (conLog) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(conLog))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (isScreenshot) {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) images.push({ filename: "screenshot.webp", dataUrl: await blobToDataUrl(blob) });
      }
    } else {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) images.push({ filename: "before.webp", dataUrl: await blobToDataUrl(blob) });
      }
      if (issue.snapshot.after) {
        const blob = await getImageBlob(issue.id, "after");
        if (blob) images.push({ filename: "after.webp", dataUrl: await blobToDataUrl(blob) });
      }
    }

    const result = await submitToLinear({
      ctx,
      images,
      video,
      logs,
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

  async function handleNotionSubmit(): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!notionAccount) {
      throw new Error(
        t("platform.notConnected.title", { platform: t("platform.tab.notion") }),
      );
    }
    if (!notionFields.databaseId || !notionSchema) {
      throw new Error(t("create.requiredMissing"));
    }

    const { ctx, networkLog, consoleLog: consoleLogForSubmit } = await buildCtxForSubmit();
    const images: NotionFileInput[] = [];
    let video: NotionFileInput | undefined;
    const logs: NotionFileInput[] = [];

    if (isVideo) {
      const blob = await getVideoBlob(issue.id);
      if (blob) video = { filename: "recording.webm", dataUrl: await blobToDataUrl(blob) };
      if (networkLog) {
        const harBlob = new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" });
        logs.push({ filename: "network-log.har", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (consoleLogForSubmit) {
        const jsonBlob = new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLogForSubmit))], { type: "application/json" });
        logs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    } else if (isScreenshot) {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) images.push({ filename: "screenshot.webp", dataUrl: await blobToDataUrl(blob) });
      }
    } else {
      if (issue.snapshot.before) {
        const blob = await getImageBlob(issue.id, "before");
        if (blob) images.push({ filename: "before.webp", dataUrl: await blobToDataUrl(blob) });
      }
      if (issue.snapshot.after) {
        const blob = await getImageBlob(issue.id, "after");
        if (blob) images.push({ filename: "after.webp", dataUrl: await blobToDataUrl(blob) });
      }
    }

    const result = await submitToNotion({
      ctx,
      images,
      video,
      logs,
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
    if (submitPlatform === "github") return handleGithubSubmit();
    if (submitPlatform === "linear") return handleLinearSubmit();
    if (submitPlatform === "notion") return handleNotionSubmit();
    return handleJiraSubmit();
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
                  onNetworkLogClick={() => setNetworkDialogOpen(true)}
                  onConsoleLogClick={() => setConsoleDialogOpen(true)}
                />
              </Card>

              {available.length === 0 ? (
                <Alert variant="ghost">
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
  onNetworkLogClick,
  onConsoleLogClick,
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
  onNetworkLogClick: () => void;
  onConsoleLogClick: () => void;
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
            alt="Captured image"
            className="h-full w-full object-contain"
          />
        </div>
      </FieldSection>
    ) : hasStyleBlock ? (
      <FieldSection key="__media" label={t("section.styleChanges")}>
        <StyleChangesTable
          beforeImage={beforeUrl}
          afterImage={afterUrl}
          diffs={diffs}
        />
      </FieldSection>
    ) : null;

  const showLogCards = isVideo && (
    (networkLogData !== null && networkLogData.captured > 0) ||
    (consoleLogData !== null && consoleLogData.captured > 0)
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
  const rows: { label: string; value: string }[] = [
    { label: "Page", value: issue.pageUrl || "-" },
    ...(issue.captureMode !== "video" && issue.tagName
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

  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-3">
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
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted/70">
          <video src={src} controls className="h-full w-full object-contain" />
        </div>
      ) : thumbnailUrl ? (
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted/70">
          <img src={thumbnailUrl} alt="Recording thumbnail" className="h-full w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}
