import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  X,
} from "lucide-react";
import { SiGithub, SiJirasoftware } from "@icons-pack/react-simple-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAppSettingsStore } from "@/store/app-settings-store";
import { dataUrlToBlob } from "@/store/blob-db";
import { useEditorStore, type EditorIssueFields } from "@/store/editor-store";
import { useIssuesStore } from "@/store/issues-store";
import {
  connectedPlatforms,
  isJiraAccountComplete,
  jiraSiteId,
  pickInitialPlatform,
  useSettingsStore,
} from "@/store/settings-store";
import type {
  JiraIssueSummary,
  JiraIssueType,
  JiraPriority,
  JiraUser,
} from "@/types/jira";
import type { PlatformId } from "@/types/platform";
import { sendBg, type JiraSubmitResult } from "@/types/messages";
import { buildStyleDiff } from "../components/StyleChangesTable";
import { buildAiMetaAttachment } from "../lib/buildAiMetaAttachment";
import { buildIssueAdf, type AdfDoc } from "../lib/buildIssueAdf";
import { buildHar, serializeHar } from "../lib/buildHar";
import { buildConsoleLogJson, serializeConsoleLog } from "../lib/buildConsoleLogJson";
import {
  buildNetworkLogSummary,
  buildConsoleLogSummary,
} from "../lib/buildLogSummary";
import type { MarkdownContext } from "../lib/buildIssueMarkdown";
import {
  submitToGithub,
  type NormalizedSubmitResult,
} from "../lib/submitToGithub";
import type { GithubMediaInput } from "../lib/buildGithubIssueBody";
import {
  GithubIssueFields,
  initialGhFields,
  type GithubIssueFieldsValue,
} from "./githubFields/GithubIssueFields";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

export function IssueCreateModal() {
  const t = useT();
  const [open, setOpen] = useState(false);

  const accounts = useSettingsStore((s) => s.accounts);
  const lastSubmittedPlatform = useSettingsStore((s) => s.lastSubmittedPlatform);
  const lastGhSubmit = useSettingsStore((s) => s.lastSubmitFields.github);
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
  const sectionConfig = useAppSettingsStore((s) => s.issueSections);

  const currentIssueId = useEditorStore((s) => s.currentIssueId);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);
  const patchIssue = useIssuesStore((s) => s.patchIssue);

  function buildCtx(): MarkdownContext {
    if (!draft || !target) throw new Error(t("create.requiredMissing"));
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
    };
  }

  async function handleJiraSubmit(ctx: MarkdownContext): Promise<NormalizedSubmitResult> {
    if (!jiraAccount?.auth || !jiraAccount.projectKey) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
    }
    if (!issueFields.issueTypeId) throw new Error(t("create.requiredMissing"));
    const description: AdfDoc = buildIssueAdf(ctx);
    const attachments: { filename: string; dataUrl: string }[] = [buildAiMetaAttachment(ctx)];

    if (captureMode === "video") {
      if (videoBlob) {
        const dataUrl = await blobToDataUrl(videoBlob);
        attachments.push({ filename: "recording.webm", dataUrl });
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

  async function handleGithubSubmit(ctx: MarkdownContext): Promise<NormalizedSubmitResult> {
    if (!ghAccount) {
      throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.github") }));
    }
    if (!ghFields.owner || !ghFields.repo) throw new Error(t("create.requiredMissing"));

    const images: GithubMediaInput[] = [];
    let video: GithubMediaInput | undefined;
    const logs: GithubMediaInput[] = [];

    if (captureMode === "video") {
      if (videoBlob) video = { filename: "recording.webm", blob: videoBlob };
      if (networkLog && networkLogAttach && networkLog.captured > 0) {
        logs.push({
          filename: "network-log.har",
          blob: new Blob([serializeHar(buildHar(networkLog))], { type: "application/json" }),
        });
      }
      if (consoleLog && consoleLogAttach && consoleLog.captured > 0) {
        logs.push({
          filename: "console-log.json",
          blob: new Blob([serializeConsoleLog(buildConsoleLogJson(consoleLog))], { type: "application/json" }),
        });
      }
    } else if (captureMode === "screenshot") {
      const screenshotImage = screenshotAnnotated ?? screenshotRaw;
      if (screenshotImage) images.push({ filename: "screenshot.webp", blob: dataUrlToBlob(screenshotImage) });
    } else {
      if (beforeImage) images.push({ filename: "before.webp", blob: dataUrlToBlob(beforeImage) });
      if (afterImage) images.push({ filename: "after.webp", blob: dataUrlToBlob(afterImage) });
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

  async function handleSubmit(submitPlatform: PlatformId): Promise<NormalizedSubmitResult> {
    const ctx = buildCtx();
    return submitPlatform === "github" ? handleGithubSubmit(ctx) : handleJiraSubmit(ctx);
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
        onSubmit={handleSubmit}
      />
    </>
  );
}

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
  onSubmit: (platform: PlatformId) => Promise<NormalizedSubmitResult>;
  onSuccess?: (result: NormalizedSubmitResult) => void;
}

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
    onSubmit,
    onSuccess,
  } = props;
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const ghAccount = useSettingsStore((s) => s.accounts.github);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    if (!open) setSubmit({ status: "idle" });
  }, [open]);

  const jiraConfigured = isJiraAccountComplete(jiraAccount);
  const ghConfigured = !!ghAccount;
  const platformConfigured =
    platform === "jira" ? jiraConfigured : ghConfigured;

  const canSubmit =
    submit.status !== "submitting" &&
    platformConfigured &&
    (platform === "jira"
      ? !!jiraFields.issueTypeId
      : !!ghFields.owner && !!ghFields.repo);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmit({ status: "submitting" });
    try {
      const result = await onSubmit(platform);
      onOpenChange(false);
      onSuccess?.(result);
    } catch (err) {
      setSubmit({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleOpenChange(next: boolean) {
    if (submit.status === "submitting") return;
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
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger
                value="jira"
                className="gap-1.5"
                disabled={!availablePlatforms.includes("jira")}
              >
                <SiJirasoftware className="h-3.5 w-3.5" color="default" />
                {t("platform.tab.jira")}
              </TabsTrigger>
              <TabsTrigger
                value="github"
                className="gap-1.5"
                disabled={!availablePlatforms.includes("github")}
              >
                <SiGithub className="h-3.5 w-3.5 dark:invert" color="default" />
                {t("platform.tab.github")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {platform === "jira" ? (
          jiraConfigured ? (
            <JiraFieldsBlock fields={jiraFields} onChange={setJiraFields} />
          ) : null
        ) : ghConfigured ? (
          <GithubIssueFields value={ghFields} onChange={setGhFields} />
        ) : null}

        {submit.status === "error" ? (
          <Alert variant="destructive" className="text-xs">
            <AlertDescription>{submit.message}</AlertDescription>
          </Alert>
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

function JiraFieldsBlock({
  fields,
  onChange,
}: {
  fields: EditorIssueFields;
  onChange: (patch: Partial<EditorIssueFields>) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("create.issueType")} required>
        <IssueTypeField
          value={fields.issueTypeId}
          onChange={(id) => onChange({ issueTypeId: id })}
        />
      </FieldRow>
      <FieldRow label={t("create.assignee")}>
        <AssigneeField
          value={fields.assigneeId}
          fallbackLabel={fields.assigneeName}
          onChange={(id, name) => onChange({ assigneeId: id, assigneeName: name })}
        />
      </FieldRow>
      <FieldRow label={t("create.priority")}>
        <PriorityField
          value={fields.priorityId}
          fallbackLabel={fields.priorityName}
          onChange={(id, name) => onChange({ priorityId: id, priorityName: name })}
        />
      </FieldRow>
      <FieldRow label={t("create.parentEpic")}>
        <EpicField
          value={fields.parentKey}
          fallbackLabel={fields.parentLabel}
          onChange={(key, label) => onChange({ parentKey: key, parentLabel: label })}
          hierarchyLevels={[1]}
        />
      </FieldRow>
      <FieldRow label={t("create.linkedIssue")}>
        <EpicField
          value={fields.relatesKey}
          fallbackLabel={fields.relatesLabel}
          onChange={(key, label) => onChange({ relatesKey: key, relatesLabel: label })}
        />
      </FieldRow>
    </div>
  );
}

export function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function useJiraConfig(): { projectKey: string } | null {
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  return useMemo(() => {
    if (!jiraAccount?.projectKey || !jiraAccount.auth) return null;
    return { projectKey: jiraAccount.projectKey };
  }, [jiraAccount?.auth, jiraAccount?.projectKey]);
}

function useDebouncedSearch<T>(
  fetchFn: (query: string) => Promise<T[]>,
  delay = 300,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const search = useCallback(
    (query: string) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      const timer = window.setTimeout(() => {
        fetchFn(query)
          .then((list) => {
            if (seq === seqRef.current) setItems(list);
          })
          .catch((err: unknown) => {
            if (seq === seqRef.current)
              setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (seq === seqRef.current) setLoading(false);
          });
      }, delay);
      return () => window.clearTimeout(timer);
    },
    [fetchFn, delay],
  );

  return { items, loading, error, search };
}

export function IssueTypeField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraIssueType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectKey = jiraAccount?.projectKey;

  useEffect(() => {
    setItems([]);
    setError(null);
  }, [projectKey]);

  useEffect(() => {
    if (!open || !jiraAccount || !projectKey) return;
    if (items.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraIssueType[]>({
      type: "jira.listIssueTypes",
      projectKey,
    })
      .then((list) => !cancelled && setItems(list))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jiraAccount, projectKey, items.length]);

  const defaultId = jiraAccount?.issueTypeId;
  const defaultName = jiraAccount?.issueTypeName;
  const effectiveValue = value ?? defaultId;
  const selected = items.find((i) => i.id === effectiveValue);

  useEffect(() => {
    if (!value && defaultId) onChange(defaultId);
  }, [value, defaultId, onChange]);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.issueType.select")}
      searchPlaceholder={t("field.issueType.search")}
      emptyMessage={t("field.issueType.empty")}
      label={selected?.name ?? (effectiveValue ? defaultName : undefined)}
    >
      {items.map((it) => (
        <CommandItem
          key={it.id}
          value={it.name}
          onSelect={() => {
            onChange(it.id);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              effectiveValue === it.id ? "opacity-100" : "opacity-0",
            )}
          />
          {it.iconUrl ? (
            <img src={it.iconUrl} alt="" className="mr-2 h-4 w-4" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{it.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

export function PriorityField({
  value,
  fallbackLabel,
  onChange,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (id: string | undefined, name?: string) => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraPriority[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jiraAccount) return;
    if (items.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraPriority[]>({ type: "jira.listPriorities" })
      .then((list) => !cancelled && setItems(list))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jiraAccount, items.length]);

  const selected = items.find((i) => i.id === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.priority.select")}
      searchPlaceholder={t("field.priority.search")}
      emptyMessage={t("field.priority.empty")}
      label={selected?.name}
      fallbackLabel={fallbackLabel}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      groupLabel={t("field.priority.label")}
    >
      {items.map((p) => (
        <CommandItem
          key={p.id}
          value={p.name}
          onSelect={() => {
            onChange(p.id, p.name);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === p.id ? "opacity-100" : "opacity-0",
            )}
          />
          {p.iconUrl ? (
            <img src={p.iconUrl} alt="" className="mr-2 h-4 w-4" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

export function AssigneeField({
  value,
  fallbackLabel,
  onChange,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (id: string | undefined, name?: string) => void;
}) {
  const t = useT();
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchUsers = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraUser[]>({
        type: "jira.searchUsers",
        query,
      });
    },
    [jira],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchUsers);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  const selected = items.find((u) => u.accountId === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.assignee.select")}
      searchPlaceholder={t("field.assignee.search")}
      emptyMessage={t("field.assignee.empty")}
      label={selected?.displayName}
      fallbackLabel={fallbackLabel}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      onSearch={search}
      groupLabel={t("field.assignee.label")}
    >
      {items.map((u) => (
        <CommandItem
          key={u.accountId}
          value={u.displayName}
          onSelect={() => {
            onChange(u.accountId, u.displayName);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === u.accountId ? "opacity-100" : "opacity-0",
            )}
          />
          {u.avatarUrls?.["16x16"] ? (
            <img
              src={u.avatarUrls["16x16"]}
              alt=""
              className="mr-2 h-4 w-4 rounded-full"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

export function EpicField({
  value,
  fallbackLabel,
  onChange,
  hierarchyLevels,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (key: string | undefined, label?: string) => void;
  hierarchyLevels?: number[];
}) {
  const t = useT();
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchEpics = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraIssueSummary[]>({
        type: "jira.searchEpics",
        projectKey: jira.projectKey,
        query: query || undefined,
        hierarchyLevels,
      });
    },
    [jira, hierarchyLevels],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchEpics);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  const selected = items.find((i) => i.key === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.epic.select")}
      searchPlaceholder={t("field.epic.search")}
      emptyMessage={t("field.epic.empty")}
      label={selected ? `${selected.key} ${selected.fields.summary}` : undefined}
      fallbackLabel={fallbackLabel}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      onSearch={search}
      groupLabel={t("field.epic.label")}
    >
      {items.map((epic) => (
        <CommandItem
          key={epic.id}
          value={`${epic.key} ${epic.fields.summary}`}
          onSelect={() => {
            onChange(epic.key, `${epic.key} ${epic.fields.summary}`);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === epic.key ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="shrink-0 text-muted-foreground">{epic.key}</span>
          <span className="ml-1.5 min-w-0 flex-1 truncate">{epic.fields.summary}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

function FieldCombobox({
  open,
  onOpenChange,
  loading,
  error,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  label,
  fallbackLabel,
  clearable,
  onClear,
  onSearch,
  groupLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  label?: string;
  fallbackLabel?: string;
  clearable?: boolean;
  onClear?: () => void;
  onSearch?: (query: string) => void;
  groupLabel?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !label && !fallbackLabel && "text-muted-foreground",
            )}
          >
            {label || fallbackLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={!onSearch}>
          <CommandInput
            placeholder={searchPlaceholder}
            onValueChange={onSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            ) : (
              <>
                {clearable && onClear ? (
                  <CommandGroup heading={t("common.actions")}>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => {
                        onClear();
                        onOpenChange(false);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="text-xs">{t("common.deselect")}</span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup heading={groupLabel}>{children}</CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}
