import { useEffect, useMemo, useState } from "react";
import { getVideoBlob } from "@/store/video-db";
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
import { useEditorStore } from "@/store/editor-store";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import {
  useSettingsStore,
  isJiraConfigComplete,
  jiraSiteId,
} from "@/store/settings-store";
import { sendBg, type JiraSubmitResult } from "@/types/messages";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "../components/StyleChangesTable";
import { buildIssueAdf } from "../lib/buildIssueAdf";
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
  onSubmitSuccess?: (result: JiraSubmitResult) => void;
}) {
  const t = useT();
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const configured = isJiraConfigComplete(jiraConfig);
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);

  const [fields, setFields] = useState<SubmitFields>({});
  const [submitOpen, setSubmitOpen] = useState(false);

  const lastSubmitFields = useSettingsStore((s) => s.lastSubmitFields);

  useEffect(() => {
    if (!open) return;
    const base: SubmitFields = { issueTypeId: jiraConfig?.issueTypeId };
    if (
      lastSubmitFields.projectKey &&
      lastSubmitFields.projectKey === jiraConfig?.projectKey
    ) {
      const { projectKey: _, ...restored } = lastSubmitFields;
      Object.assign(base, restored);
    }
    setFields(base);
    setSubmitOpen(false);
  }, [open, issue?.id, jiraConfig?.issueTypeId, jiraConfig?.projectKey, lastSubmitFields]);

  const isScreenshot = issue?.captureMode === "screenshot";
  const isVideo = issue?.captureMode === "video";

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

  async function handleSubmit(): Promise<JiraSubmitResult> {
    if (!issue) throw new Error("초안 없음");
    if (!jiraConfig?.auth || !jiraConfig.projectKey)
      throw new Error("Jira 미설정");
    if (!fields.issueTypeId) throw new Error("이슈 타입 선택 필요");

    const sel = issue.selectionSnapshot;
    const ctx = {
      captureMode: issue.captureMode,
      title: issue.draft.title,
      body: issue.draft.body,
      expectedResult: issue.draft.expectedResult,
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
    };
    const description = buildIssueAdf(ctx);

    const summary = issue.draft.title.trim();

    const attachments: { filename: string; dataUrl: string }[] = [];
    if (isVideo) {
      const blob = await getVideoBlob(issue.id);
      if (blob) {
        const dataUrl = await blobToDataUrl(blob);
        attachments.push({ filename: "recording.webm", dataUrl });
      }
    } else if (isScreenshot) {
      if (issue.snapshot.before)
        attachments.push({ filename: "screenshot.jpg", dataUrl: issue.snapshot.before });
    } else {
      if (issue.snapshot.before)
        attachments.push({ filename: "before.jpg", dataUrl: issue.snapshot.before });
      if (issue.snapshot.after)
        attachments.push({ filename: "after.jpg", dataUrl: issue.snapshot.after });
    }

    const result = await sendBg<JiraSubmitResult>({
      type: "jira.submitIssue",
      payload: {
        projectKey: jiraConfig.projectKey,
        summary,
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
      key: result.key,
      url: result.url,
      jiraSiteId: jiraConfig?.auth ? jiraSiteId(jiraConfig.auth) : undefined,
    });
    if (useEditorStore.getState().currentIssueId === issue.id) {
      useEditorStore.getState().reset();
    }
    useSettingsStore.getState().setLastSubmitFields({
      projectKey: jiraConfig.projectKey,
      assigneeId: fields.assigneeId,
      assigneeName: fields.assigneeName,
      priorityId: fields.priorityId,
      priorityName: fields.priorityName,
      parentKey: fields.parentKey,
      parentLabel: fields.parentLabel,
      relatesKey: fields.relatesKey,
      relatesLabel: fields.relatesLabel,
    });
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

                {issue.draft.body ? (
                  <FieldSection label={t("section.description")}>
                    <DocBody value={issue.draft.body} />
                  </FieldSection>
                ) : null}

                {isVideo && issue.snapshot.before ? (
                  <FieldSection label={t("section.media")}>
                    <DraftVideoPreview issue={issue} />
                  </FieldSection>
                ) : hasScreenshot ? (
                  <FieldSection label={t("section.media")}>
                    <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted/70">
                      <img
                        src={issue.snapshot.before!}
                        alt="Captured image"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </FieldSection>
                ) : hasStyleBlock ? (
                  <FieldSection label={t("section.styleChanges")}>
                    <StyleChangesTable
                      beforeImage={issue.snapshot.before}
                      afterImage={issue.snapshot.after}
                      diffs={diffs}
                    />
                  </FieldSection>
                ) : null}

                {issue.draft.expectedResult ? (
                  <FieldSection label={t("section.expectedResult")}>
                    <DocBody value={issue.draft.expectedResult} />
                  </FieldSection>
                ) : null}
              </Card>

              {!configured ? (
                <Alert variant="ghost">
                  <Info className="h-4 w-4" />
                  <AlertTitle>{t("jira.notConnected.title")}</AlertTitle>
                  <AlertDescription>
                    {t("jira.notConnected.body")}
                  </AlertDescription>
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
                    disabled={!configured}
                    onClick={() => setSubmitOpen(true)}
                  >
                    {t("jira.submit")}
                  </Button>
                </div>
              </DialogFooter>
        </DialogContent>
      </Dialog>

      <SubmitFieldsDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title={t("jira.submit")}
        fields={fields}
        onFieldsChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
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

function EnvBlock({ issue }: { issue: IssueRecord }) {
  const rows: { label: string; value: string }[] = [
    { label: "Page", value: issue.pageUrl || "-" },
    ...(issue.captureMode !== "video" && issue.selector
      ? [{ label: "DOM", value: issue.selector }]
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

function DraftVideoPreview({ issue }: { issue: IssueRecord }) {
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
        <video src={src} controls className="max-h-60 w-full rounded-md border object-contain" />
      ) : issue.snapshot.before ? (
        <img src={issue.snapshot.before} alt="Recording thumbnail" className="max-h-60 rounded-md border object-contain" />
      ) : null}
    </div>
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

function DocBody({ value }: { value: string }) {
  const t = useT();
  if (!value.trim()) {
    return <p className="text-sm text-muted-foreground/70">{t("common.empty")}</p>;
  }
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {value}
    </div>
  );
}
