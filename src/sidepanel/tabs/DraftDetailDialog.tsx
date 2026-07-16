import { useEffect, useMemo, useState } from "react";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { getVideoBlob, getImageBlob, getNetworkLog, getConsoleLog, getActionLog, getAttachmentBlob, blobToDataUrl, pruneOrphanInlineImages } from "@/store/blob-db";
import type { UserAttachmentMeta } from "@/types/attachment";
import { useIssueImages } from "@/sidepanel/hooks/useIssueImages";
import { Pencil } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  POST_MEDIA_SECTION_IDS,
  sectionLabelKey,
  useSettingsUiStore,
  type IssueSection,
} from "@/store/settings-ui-store";
import { useEditorStore } from "@/store/editor-store";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { clearPicker } from "@/sidepanel/picker-control";
import { useTabNav } from "@/sidepanel/tab-nav";
import { IntegrationsCta } from "@/sidepanel/components/IntegrationsCta";
import {
  connectedPlatforms,
  jiraSiteId,
  pickInitialPlatform,
  useSettingsStore,
} from "@/store/settings-store";
import {
  canEditDraftFields,
  isSlackPreserved,
  resolveInitialPlatform,
  submittablePlatforms,
} from "./issueListUtils";
import {
  PLATFORM_TAB_KEYS,
  type NormalizedSubmitResult,
  type PlatformId,
} from "@/types/platform";
import { postSlackPromotionReply } from "@/sidepanel/lib/slackPromotionLink";
import { submitToJira } from "@/sidepanel/lib/submitToJira";
import { submitToGithub } from "@/sidepanel/lib/submitToGithub";
import { submitToLinear } from "@/sidepanel/lib/submitToLinear";
import { submitToNotion } from "@/sidepanel/lib/submitToNotion";
import { submitToGitlab } from "@/sidepanel/lib/submitToGitlab";
import { submitToAsana } from "@/sidepanel/lib/submitToAsana";
import { submitToClickup } from "@/sidepanel/lib/submitToClickup";
import { submitToSlack } from "@/sidepanel/lib/submitToSlack";
import { formatTimestamp } from "@/sidepanel/lib/formatTimestamp";
import type { NotionDatabaseSchema } from "@/types/notion";
import { usePlatformFields } from "@/sidepanel/hooks/usePlatformFields";
import { extractNotionPageId } from "@/lib/notion-page-id";
import { DraftEditDialog } from "./DraftEditDialog";
import {
  applyDraftFieldEdit,
  type DraftEditTarget,
} from "@/sidepanel/lib/applyDraftFieldEdit";
import { DocSectionBody } from "@/sidepanel/components/DocSectionBody";
import { AttachmentList } from "@/sidepanel/components/AttachmentList";
import { downloadAttachment } from "@/sidepanel/lib/downloadAttachment";
import { LogAttachmentCards } from "@/sidepanel/components/LogAttachmentCards";
import { NetworkLogPreviewDialog } from "@/sidepanel/components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "@/sidepanel/components/ConsoleLogPreviewDialog";
import { ActionLogPreviewDialog } from "@/sidepanel/components/ActionLogPreviewDialog";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "@/sidepanel/components/StyleChangesTable";
import {
  useDraftStyleElements,
  loadDraftStyleImages,
} from "@/sidepanel/hooks/useDraftStyleElements";
import { resolveDraftStyleElements } from "@/sidepanel/lib/resolveDraftStyleElements";
import { joinStyleSelectors, type StyleElementContext } from "@/sidepanel/lib/buildIssueMarkdown";
import { buildCaptureFiles, type CaptureFiles } from "@/sidepanel/lib/buildCaptureFiles";
import { deriveContextEnvRows } from "@/sidepanel/lib/buildReportData";
import { supportsConsoleNetworkLog, supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { filterEnvironmentRows, parseChromeVersion } from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import { extractInlineRefs, resolveInlineImagesForSections } from "@/sidepanel/lib/resolveInlineImages";
import { initialJiraFields } from "@/sidepanel/lib/initialJiraFields";
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
  cc?: { accountId: string; displayName: string }[];
};

export function DraftDetailDialog({
  issue,
  open,
  onOpenChange,
  onSubmitSuccess,
  autoOpenSubmit,
}: {
  issue: IssueRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitSuccess?: (result: NormalizedSubmitResult) => void;
  autoOpenSubmit?: boolean;
}) {
  const t = useT();
  const accounts = useSettingsStore((s) => s.accounts);
  const jiraAccount = accounts.jira;
  const ghAccount = accounts.github;
  const linearAccount = accounts.linear;
  const notionAccount = accounts.notion;
  const gitlabAccount = accounts.gitlab;
  const asanaAccount = accounts.asana;
  const clickupAccount = accounts.clickup;
  const slackAccount = accounts.slack;
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);
  const markSlackShared = useIssuesStore((s) => s.markSlackShared);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const sectionConfig = useSettingsUiStore((s) => s.issueSections);

  const [fields, setFields] = useState<SubmitFields>({});
  const [submitOpen, setSubmitOpen] = useState(false);

  const lastJiraSubmit = useSettingsStore((s) => s.lastSubmitFields.jira);
  const lastGhSubmit = useSettingsStore((s) => s.lastSubmitFields.github);
  const lastLinearSubmit = useSettingsStore((s) => s.lastSubmitFields.linear);
  const lastNotionSubmit = useSettingsStore((s) => s.lastSubmitFields.notion);
  const lastGitlabSubmit = useSettingsStore((s) => s.lastSubmitFields.gitlab);
  const lastAsanaSubmit = useSettingsStore((s) => s.lastSubmitFields.asana);
  const lastClickupSubmit = useSettingsStore((s) => s.lastSubmitFields.clickup);
  const lastSlackSubmit = useSettingsStore((s) => s.lastSubmitFields.slack);
  const lastSubmittedPlatform = useSettingsStore((s) => s.lastSubmittedPlatform);

  const navTo = useTabNav();

  // Slack 보존 이슈는 Slack 탭을 제외(승격 전용). 그 외엔 연결된 전체 플랫폼.
  const available = useMemo(
    () => (issue ? submittablePlatforms(issue, accounts) : connectedPlatforms(accounts)),
    [issue, accounts],
  );
  const initialPlatform = useMemo(
    () => resolveInitialPlatform(pickInitialPlatform(accounts, lastSubmittedPlatform), available),
    [accounts, lastSubmittedPlatform, available],
  );
  const [platform, setPlatform] = useState<PlatformId>(initialPlatform);
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
    resetKey: issue?.id,
  });
  const [notionSchema, setNotionSchema] = useState<NotionDatabaseSchema | null>(null);
  const [editTarget, setEditTarget] = useState<DraftEditTarget | null>(null);

  // 다이얼로그 진입 prefill — open / issue.id 변경 시에만 동작.
  // 사용자가 SubmitFieldsDialog의 Tab으로 platform을 바꾸면 patchIssue로 issue.platform이
  // 갱신되는데, 그걸 deps에 넣으면 이 effect가 재실행되어 setSubmitOpen(false)/setPlatform(initial)이
  // 사용자 인터랙션을 덮어쓴다 (Tab 전환 시 SubmitFieldsDialog가 강제로 닫히는 버그). 그래서 의도적으로 제외.
  useEffect(() => {
    if (!open) return;
    // 캡처→제출 경로(editor-store.confirmDraft)와 같은 단일 출처를 쓴다 — 여기서 갈리면
    // Connect 탭의 기본 담당자가 드래프트 재제출에만 안 붙는다.
    setFields(initialJiraFields(lastJiraSubmit, jiraAccount));
    const picked =
      issue && accounts[issue.platform]
        ? issue.platform
        : pickInitialPlatform(accounts, lastSubmittedPlatform);
    // Slack 보존 이슈는 issue.platform이 "slack"이라 available에서 빠지므로 첫 트래커로 보정.
    setPlatform(resolveInitialPlatform(picked, available));
    setSubmitOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, issue?.id]);

  // [승격] 진입 — prefill effect와 분리(deps에 issue.platform 트랩 회피). 열릴 때 제출 다이얼로그 자동 오픈.
  useEffect(() => {
    if (open && autoOpenSubmit) setSubmitOpen(true);
  }, [open, autoOpenSubmit]);

  function handlePlatformChange(p: PlatformId) {
    setPlatform(p);
    // Slack 보존 이슈는 platform="slack"을 유지해야 PlatformChip·permalink·canPromoteSlack이
    // 일치한다. 승격 탭 전환을 영속화하면 미제출 닫기 시 platform만 트래커로 바뀌어 불일치.
    // (실제 승격은 markSubmitted→stripSubmitted가 platform을 올바르게 세팅) — 일반 draft만 영속화.
    if (issue && !isSlackPreserved(issue) && issue.platform !== p) {
      patchIssue(issue.id, { platform: p });
    }
  }

  const isScreenshot = issue?.captureMode === "screenshot";
  const isVideo = issue?.captureMode === "video";
  const isFreeform = issue?.captureMode === "freeform";
  const { beforeUrl } = useIssueImages(issue?.id ?? null, issue?.snapshot);
  const styleElements = useDraftStyleElements(
    issue ?? null,
    open && !isScreenshot && !isVideo && !isFreeform,
  );

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

  // 현재 element에 diff가 없어도 버퍼 element가 있으면 element 모드 draft다(라이브 제출과 동일).
  const hasBufferedStyle = (issue.bufferedElements?.length ?? 0) > 0;
  const hasStyleBlock =
    !isScreenshot &&
    (!!issue.snapshot.before ||
      !!issue.snapshot.after ||
      diffs.length > 0 ||
      hasBufferedStyle);
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
    // legacy no-diff draft fallback — 현재 element diff도 없고 버퍼도 없을 때만. 버퍼가 있으면
    // element 모드를 유지해 버퍼 변경이 본문에서 소실되지 않게 한다(라이브 제출과 파리티).
    const legacyNoDiff =
      !isScreenshot && !isVideo && !isFreeform && diffs.length === 0 && !hasBufferedStyle;
    const isElement = !isScreenshot && !isVideo && !isFreeform && !legacyNoDiff;
    // 현재 + 버퍼 element를 라이브와 동일 규칙으로 병합 — 본문·캡처 파일 인덱스 단일 출처.
    const styleImages = isElement ? await loadDraftStyleImages(issue) : null;
    const styleElementsForSubmit = styleImages
      ? resolveDraftStyleElements(issue, styleImages)
      : [];
    const ctx = {
      os: getOsInfo(),
      browser: parseChromeVersion(navigator.userAgent),
      captureMode: legacyNoDiff ? "screenshot" : issue.captureMode,
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
      styleElements: isElement ? styleElementsForSubmit : undefined,
      environment: issue.draft.environment ?? [],
      networkLogSummary: networkLog ? buildNetworkLogSummary(networkLog) : undefined,
      consoleLogSummary: consoleLogForSubmit ? buildConsoleLogSummary(consoleLogForSubmit) : undefined,
      actionLogCaptured: actionLogForSubmit && actionLogForSubmit.captured > 0 ? actionLogForSubmit.captured : undefined,
    };

    // 사용자 첨부: 확정 draft라 blob은 issueId 키. 메타 순서대로 로드(없으면 제외).
    let userAttachments: { meta: UserAttachmentMeta; blob: Blob }[] | undefined;
    if (issue.attachments?.length) {
      const loaded = await Promise.all(
        issue.attachments.map(async (meta) => {
          const blob = await getAttachmentBlob(issue.id, meta.id);
          return blob ? { meta, blob } : null;
        }),
      );
      userAttachments = loaded.filter(
        (x): x is { meta: UserAttachmentMeta; blob: Blob } => x !== null,
      );
    }

    const videoBlob = isVideo ? await getVideoBlob(issue.id) : null;
    const beforeBlob = (isScreenshot || legacyNoDiff) && issue.snapshot.before
      ? await getImageBlob(issue.id, "before")
      : null;
    const beforeDataUrl = beforeBlob ? await blobToDataUrl(beforeBlob) : null;
    const captureFiles = await buildCaptureFiles({
      captureMode: legacyNoDiff ? "screenshot" : (issue.captureMode ?? "element"),
      videoBlob,
      screenshotImage: isScreenshot || legacyNoDiff ? beforeDataUrl : null,
      beforeImages: isElement ? styleElementsForSubmit.map((e) => e.beforeImage ?? null) : undefined,
      afterImages: isElement ? styleElementsForSubmit.map((e) => e.afterImage ?? null) : undefined,
      networkLog,
      consoleLog: consoleLogForSubmit,
      actionLog: actionLogForSubmit,
      userAttachments,
      // 영상 동기화 앵커. videoThumbnail은 IssueRecord 미영속 → 저장 draft logs.html은 poster 생략.
      videoStartedAt: issue.videoStartedAt,
      videoEndedAt: issue.videoEndedAt,
      pageUrl: issue.pageUrl,
      issueTitle: issue.title?.trim() || undefined,
      report: {
        title: issue.draft.title,
        sections: issue.draft.sections,
        sectionConfig,
        envRows: deriveContextEnvRows(ctx),
        markdownContext: ctx,
      },
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

    const jiraInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToJira({
      ctx,
      inlineImages: jiraInline,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      attachments: captureFiles.attachments,
      projectKey: jiraAccount.projectKey,
      summary: issue.draft.title.trim(),
      issueTypeId: fields.issueTypeId,
      assigneeAccountId: fields.assigneeId,
      priorityId: fields.priorityId,
      parentKey: fields.parentKey,
      relatesKey: fields.relatesKey,
      cc: fields.cc,
    });
    // 승격 가드 없음: submitToJira는 업로드+생성이 단일 atomic 호출(jira.submitIssue)이라
    // 프론트가 첨부 부분 실패를 신호받지 못한다. 가드하려면 background 핸들러 수정 필요. (docs/POSTMORTEM.md)
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
      cc: fields.cc,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("jira");
    return { key: result.key, url: result.url, logsDropped: result.logsDropped };
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
      attachments: captureFiles.attachments,
      inlineImages: ghInline,
      owner: ghFields.owner,
      repo: ghFields.repo,
      label: ghFields.label,
      assignee: ghFields.assignee,
      cc: ghFields.cc,
      // 승격은 markSubmitted가 Slack 원본을 파괴하므로 미디어 업로드 실패 시 등록 전 중단.
      requireMediaUpload: isSlackPreserved(issue),
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
      cc: ghFields.cc,
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
      attachments: captureFiles.attachments,
      inlineImages: linearInline,
      teamId: linearFields.teamId,
      projectId: linearFields.projectId,
      labelId: linearFields.labelId,
      assigneeId: linearFields.assigneeId,
      priority: linearFields.priority,
      cc: linearFields.cc,
    });
    // 승격 가드 불필요: submitToLinear는 이미지·비디오·인라인을 생성 전 업로드하고 실패 시 throw하므로
    // (href:null soft-fail 없음) 미디어 실패는 markSubmitted에 도달하지 못한다 — 원본 보존됨.
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
      cc: linearFields.cc,
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
      attachments: captureFiles.attachments,
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
      cc: notionFields.cc?.map((u) => u.id),
      // 승격은 markSubmitted가 Slack 원본을 파괴하므로 사용자 첨부 업로드 실패 시 등록 전 중단.
      // (이미지·비디오는 submitToNotion에서 상시 strict라 별도 가드 불필요.)
      requireMediaUpload: isSlackPreserved(issue),
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
      cc: notionFields.cc,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("notion");
    return result;
  }

  async function handleGitlabSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!gitlabAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.gitlab") }));
    }
    if (!gitlabFields.projectId) throw new Error(t("create.requiredMissing"));

    const gitlabInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToGitlab({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      attachments: captureFiles.attachments,
      inlineImages: gitlabInline,
      projectId: gitlabFields.projectId,
      label: gitlabFields.label,
      assigneeId: gitlabFields.assigneeId,
      cc: gitlabFields.cc?.map((u) => u.username),
      // 승격은 markSubmitted가 Slack 원본을 파괴하므로 미디어 업로드 실패 시 등록 전 중단.
      requireMediaUpload: isSlackPreserved(issue),
    });
    markSubmitted(issue.id, {
      platform: "gitlab",
      key: result.key,
      url: result.url,
      gitlabProjectId: gitlabFields.projectId,
      gitlabIssueIid: Number(result.key.replace(/^#/, "")),
      gitlabLabels: gitlabFields.label ? [gitlabFields.label] : undefined,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("gitlab", {
      projectId: gitlabFields.projectId,
      projectPath: gitlabFields.projectPath,
      label: gitlabFields.label,
      assigneeId: gitlabFields.assigneeId,
      assigneeName: gitlabFields.assigneeName,
      cc: gitlabFields.cc,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("gitlab");
    return result;
  }

  async function handleAsanaSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!asanaAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.asana") }));
    }
    if (!asanaFields.workspaceGid) throw new Error(t("create.requiredMissing"));

    const asanaInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToAsana({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      attachments: captureFiles.attachments,
      inlineImages: asanaInline,
      workspaceGid: asanaFields.workspaceGid,
      projectGid: asanaFields.projectGid,
      assigneeGid: asanaFields.assigneeGid,
      cc: asanaFields.cc,
    });
    // 승격 가드 없음: submitToAsana는 task를 먼저 생성하고(attachment에 parent gid 필요) 그 뒤 업로드해서,
    // 업로드 부분 실패를 등록 전에 막을 수 없다(생성→업로드 역순). 보호하려면 사전 probe/롤백 설계 필요. (docs/POSTMORTEM.md)
    markSubmitted(issue.id, {
      platform: "asana",
      key: result.key,
      url: result.url,
      asanaTaskGid: result.key,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("asana", {
      workspaceGid: asanaFields.workspaceGid,
      workspaceName: asanaFields.workspaceName,
      projectGid: asanaFields.projectGid,
      projectName: asanaFields.projectName,
      assigneeGid: asanaFields.assigneeGid,
      assigneeName: asanaFields.assigneeName,
      cc: asanaFields.cc,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("asana");
    return result;
  }

  async function handleClickupSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!clickupAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.clickup") }));
    }
    if (!clickupFields.workspaceId || !clickupFields.listId) {
      throw new Error(t("create.requiredMissing"));
    }

    const clickupInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToClickup({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      attachments: captureFiles.attachments,
      inlineImages: clickupInline,
      listId: clickupFields.listId,
      assigneeId: clickupFields.assigneeId,
      cc: clickupFields.cc,
    });
    // 승격 가드 없음: submitToClickup은 task를 먼저 생성하고(attachment에 task id 필요) 그 뒤 업로드해서,
    // 업로드 부분 실패를 등록 전에 막을 수 없다(생성→업로드 역순). 보호하려면 사전 probe/롤백 설계 필요. (docs/POSTMORTEM.md)
    markSubmitted(issue.id, {
      platform: "clickup",
      key: result.key,
      url: result.url,
      clickupTaskId: result.key,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("clickup", {
      workspaceId: clickupFields.workspaceId,
      workspaceName: clickupFields.workspaceName,
      spaceId: clickupFields.spaceId,
      spaceName: clickupFields.spaceName,
      listId: clickupFields.listId,
      listName: clickupFields.listName,
      assigneeId: clickupFields.assigneeId,
      assigneeName: clickupFields.assigneeName,
      cc: clickupFields.cc,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("clickup");
    return result;
  }

  async function handleSlackSubmit(
    ctx: Awaited<ReturnType<typeof buildCtxForSubmit>>["ctx"],
    captureFiles: CaptureFiles,
  ): Promise<NormalizedSubmitResult> {
    if (!issue) throw new Error(t("create.requiredMissing"));
    if (!slackAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.slack") }));
    }
    if (!slackFields.channelId) throw new Error(t("create.requiredMissing"));

    const slackInline = await resolveInlineImagesForSections(ctx.sections, sectionConfig);
    const result = await submitToSlack({
      ctx,
      images: captureFiles.images,
      video: captureFiles.video,
      logs: captureFiles.logs,
      attachments: captureFiles.attachments,
      inlineImages: slackInline,
      channelId: slackFields.channelId,
      mentions: slackFields.mentions,
    });
    markSlackShared(issue.id, {
      key: result.key,
      url: result.url,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      const tabId = useEditorStore.getState().target?.tabId;
      if (tabId != null) void clearPicker(tabId);
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields("slack", {
      channelId: slackFields.channelId,
      channelName: slackFields.channelName,
      mentions: slackFields.mentions,
    });
    useSettingsStore.getState().setLastSubmittedPlatform("slack");
    return result;
  }

  async function handleSubmit(submitPlatform: PlatformId): Promise<NormalizedSubmitResult> {
    // markSubmitted가 issue.url/key를 트래커 값으로 덮고 slackPreserved를 비우므로 사전 캡처.
    const slackOrigin =
      issue && isSlackPreserved(issue) && slackAccount
        ? { permalink: issue.url ?? "", ts: issue.key ?? "" }
        : null;
    const { ctx, captureFiles } = await buildCtxForSubmit();
    let result: NormalizedSubmitResult;
    if (submitPlatform === "github") result = await handleGithubSubmit(ctx, captureFiles);
    else if (submitPlatform === "linear") result = await handleLinearSubmit(ctx, captureFiles);
    else if (submitPlatform === "notion") result = await handleNotionSubmit(ctx, captureFiles);
    else if (submitPlatform === "gitlab") result = await handleGitlabSubmit(ctx, captureFiles);
    else if (submitPlatform === "asana") result = await handleAsanaSubmit(ctx, captureFiles);
    else if (submitPlatform === "clickup") result = await handleClickupSubmit(ctx, captureFiles);
    else if (submitPlatform === "slack") result = await handleSlackSubmit(ctx, captureFiles);
    else result = await handleJiraSubmit(ctx, captureFiles);
    if (slackOrigin && submitPlatform !== "slack" && result.url) {
      const text = `${t("slack.promotedComment", {
        platform: t(PLATFORM_TAB_KEYS[submitPlatform]),
      })}\n${result.url}`;
      void postSlackPromotionReply({ ...slackOrigin, text });
    }
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

  function handleSaveEdit(nextValue: string) {
    if (!issue || !editTarget) return;
    patchIssue(issue.id, applyDraftFieldEdit(issue, editTarget, nextValue, Date.now()));
    setEditTarget(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl" data-testid="draft-detail-dialog">
              <DialogHeader>
                <DialogTitle className="text-xl">{t("draftDetail.title")}</DialogTitle>
              </DialogHeader>

              <div
                className={cn(
                  "-m-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-1",
                  // 배너가 -mt-5로 스크롤 영역에 붙으므로 본문 끝이 배너에 닿지 않게 여백을 회복한다.
                  available.length === 0 && "pb-5",
                )}
              >
                <FieldSection
                  label={t("section.issueTitle")}
                  action={
                    canEditDraftFields(issue) ? (
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        title={t("draftDetail.edit")}
                        aria-label={t("draftDetail.edit")}
                        data-testid="edit-title"
                        onClick={() =>
                          setEditTarget({ kind: "title", value: issue.draft.title })
                        }
                      >
                        <Pencil />
                      </Button>
                    ) : undefined
                  }
                >
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
                  styleElements={styleElements}
                  isVideo={isVideo}
                  hasScreenshot={hasScreenshot}
                  hasStyleBlock={hasStyleBlock}
                  networkLogData={networkLogData}
                  consoleLogData={consoleLogData}
                  actionLogData={actionLogData}
                  onNetworkLogClick={() => setNetworkDialogOpen(true)}
                  onConsoleLogClick={() => setConsoleDialogOpen(true)}
                  onActionLogClick={() => setActionDialogOpen(true)}
                  editable={canEditDraftFields(issue)}
                  onEditSection={(sec) =>
                    setEditTarget({
                      kind: "section",
                      section: sec,
                      value: issue.draft.sections[sec.id] ?? "",
                    })
                  }
                />

                {issue.attachments && issue.attachments.length > 0 ? (
                  <FieldSection label={t("section.attachments")}>
                    <AttachmentList
                      attachments={issue.attachments}
                      onDownload={(m) => void downloadAttachment(issue.id, m)}
                    />
                  </FieldSection>
                ) : null}
              </div>

              {available.length === 0 && (
                <IntegrationsCta
                  className="-mx-6 -mt-5 -mb-5"
                  onNavigate={() => {
                    onOpenChange(false);
                    navTo("integrations");
                  }}
                />
              )}

              <DialogFooter className="!flex-row items-center !justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive-outline">
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
        onOpenChange={(v) => {
          setSubmitOpen(v);
          // 승격 진입은 제출 다이얼로그가 메인 화면 — 닫으면(취소 포함) 초안 다이얼로그까지
          // 닫고 이슈 목록으로 돌아간다. 일반 진입([자세히])은 초안 검토를 위해 유지.
          if (!v && autoOpenSubmit) onOpenChange(false);
        }}
        title={t("issue.submit")}
        platform={platform}
        setPlatform={handlePlatformChange}
        captureMode={issue?.captureMode}
        availablePlatforms={available}
        jiraFields={fields}
        setJiraFields={(patch) => setFields((f) => ({ ...f, ...patch }))}
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
        onSuccess={(result) => {
          onOpenChange(false);
          onSubmitSuccess?.(result);
        }}
      />
      <DraftEditDialog
        open={editTarget !== null}
        target={editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        onSave={handleSaveEdit}
      />
    </>
  );
}

function FieldSection({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {action ? (
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">{label}</Label>
          {action}
        </div>
      ) : (
        <Label className="text-base font-semibold">{label}</Label>
      )}
      {children}
    </div>
  );
}

function DraftDetailSections({
  issue,
  sectionConfig,
  beforeUrl,
  styleElements,
  isVideo,
  hasScreenshot,
  hasStyleBlock,
  networkLogData,
  consoleLogData,
  actionLogData,
  onNetworkLogClick,
  onConsoleLogClick,
  onActionLogClick,
  editable,
  onEditSection,
}: {
  issue: IssueRecord;
  sectionConfig: IssueSection[];
  beforeUrl: string | null;
  styleElements: StyleElementContext[];
  isVideo: boolean;
  hasScreenshot: boolean;
  hasStyleBlock: boolean;
  networkLogData: NetworkLog | null;
  consoleLogData: ConsoleLog | null;
  actionLogData: ActionLog | null;
  onNetworkLogClick: () => void;
  onConsoleLogClick: () => void;
  onActionLogClick: () => void;
  editable: boolean;
  onEditSection: (section: IssueSection) => void;
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
    ) : hasStyleBlock && styleElements.length > 0 ? (
      styleElements.map((el) => (
        <FieldSection
          key={el.selector}
          label={`${t("section.styleChanges")} (${el.selector})`}
        >
          <StyleChangesTable
            beforeImage={el.beforeImage ?? null}
            afterImage={el.afterImage ?? null}
            diffs={el.diffs}
          />
        </FieldSection>
      ))
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
    if (!editable && !value.trim()) continue;
    const label = sec.labelOverride?.trim() || t(sectionLabelKey(sec.id));
    out.push(
      <FieldSection
        key={sec.id}
        label={label}
        action={
          editable ? (
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              title={t("draftDetail.edit")}
              aria-label={t("draftDetail.edit")}
              data-testid={`edit-field-${sec.id}`}
              onClick={() => onEditSection(sec)}
            >
              <Pencil />
            </Button>
          ) : undefined
        }
      >
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
  // 버퍼+현재 element 병합 selector를 쉼표로 나열(이미지는 selector에 무관 → 빈 값).
  const styleElements = resolveDraftStyleElements(issue, {
    before: null,
    after: null,
    buffered: [],
  });
  const domLabel = joinStyleSelectors(styleElements, issue.selector);
  const rows: { label: string; value: string }[] = [
    ...(os ? [{ label: "OS", value: os }] : []),
    ...(browser ? [{ label: "Browser", value: browser }] : []),
    { label: "Page", value: issue.pageUrl || "-" },
    ...(domLabel ? [{ label: "DOM", value: domLabel }] : []),
  ];
  const vp = issue.viewport ?? issue.selectionSnapshot?.viewport;
  if (vp) {
    rows.push({ label: "Viewport", value: `${vp.width}×${vp.height}` });
  }
  rows.push({ label: "Captured", value: formatTimestamp(issue.createdAt) });
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
  const t = useT();
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
          <img src={thumbnailUrl} alt={t("alt.recordingThumbnail")} className="h-full w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}
