import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import {
  useSettingsStore,
  isJiraConfigComplete,
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
  priorityId?: string;
  parentKey?: string;
  relatesKey?: string;
};

export function DraftDetailDialog({
  issue,
  open,
  onOpenChange,
}: {
  issue: IssueRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const configured = isJiraConfigComplete(jiraConfig);
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const markSubmitted = useIssuesStore((s) => s.markSubmitted);

  const [fields, setFields] = useState<SubmitFields>({});
  const [submitOpen, setSubmitOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFields({ issueTypeId: jiraConfig?.issueTypeId });
    setSubmitOpen(false);
  }, [open, issue?.id, jiraConfig?.issueTypeId]);

  const diffs = useMemo(() => {
    if (!issue?.selectionSnapshot) return [];
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
    !!issue.snapshot.before || !!issue.snapshot.after || diffs.length > 0;

  async function handleSubmit(): Promise<JiraSubmitResult> {
    if (!issue) throw new Error("초안 없음");
    if (!jiraConfig?.auth || !jiraConfig.projectKey)
      throw new Error("Jira 미설정");
    if (!fields.issueTypeId) throw new Error("이슈 타입 선택 필요");

    const sel = issue.selectionSnapshot;
    const ctx = {
      title: issue.draft.title,
      body: issue.draft.body,
      expectedResult: issue.draft.expectedResult,
      url: issue.pageUrl,
      selector: issue.selector,
      tagName: issue.tagName ?? "",
      classListBefore: sel?.classList ?? [],
      classListAfter: issue.styleEdits.classList,
      specifiedStyles: sel?.specifiedStyles ?? {},
      tokens: issue.tokensSnapshot ?? [],
      viewport: sel?.viewport ?? { width: 0, height: 0 },
      capturedAt: sel?.capturedAt ?? issue.createdAt,
      diffs,
    };
    const description = buildIssueAdf(ctx);

    const titlePrefix = jiraConfig.titlePrefix?.trim() ?? "";
    const summary =
      titlePrefix && !issue.draft.title.startsWith(titlePrefix)
        ? `${titlePrefix}${issue.draft.title}`.trim()
        : issue.draft.title.trim();

    const attachments: { filename: string; dataUrl: string }[] = [];
    if (issue.snapshot.before)
      attachments.push({
        filename: "before.png",
        dataUrl: issue.snapshot.before,
      });
    if (issue.snapshot.after)
      attachments.push({
        filename: "after.png",
        dataUrl: issue.snapshot.after,
      });

    const result = await sendBg<JiraSubmitResult>({
      type: "jira.submitIssue",
      config: jiraConfig.auth,
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
    markSubmitted(issue.id, { key: result.key, url: result.url });
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
            <DialogTitle className="text-xl">초안 검토</DialogTitle>
          </DialogHeader>

          <Card className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain bg-background p-4 text-[13px]">
            <EnvBlock issue={issue} />

            <FieldSection label="제목">
              <p className="text-sm font-medium break-words">
                {issue.draft.title || "(제목 없음)"}
              </p>
            </FieldSection>

            {issue.draft.body ? (
              <FieldSection label="발생 현상">
                <DocBody value={issue.draft.body} />
              </FieldSection>
            ) : null}

            {hasStyleBlock ? (
              <FieldSection label="스타일 변경">
                <StyleChangesTable
                  beforeImage={issue.snapshot.before}
                  afterImage={issue.snapshot.after}
                  diffs={diffs}
                />
              </FieldSection>
            ) : null}

            {issue.draft.expectedResult ? (
              <FieldSection label="기대 결과">
                <DocBody value={issue.draft.expectedResult} />
              </FieldSection>
            ) : null}
          </Card>

          {!configured ? (
            <Alert>
              <AlertDescription>
                설정 탭에서 Jira를 먼저 연결하세요.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 />
                  삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>초안을 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>
                    삭제된 초안은 복구할 수 없습니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className={buttonVariants({ variant: "destructive" })}
                  >
                    삭제
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
              <Button
                disabled={!configured}
                onClick={() => setSubmitOpen(true)}
              >
                Jira 이슈 제출
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SubmitFieldsDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="Jira 이슈 제출"
        fields={fields}
        onFieldsChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
        onSubmit={handleSubmit}
        onSuccess={() => onOpenChange(false)}
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
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EnvBlock({ issue }: { issue: IssueRecord }) {
  const rows: { label: string; value: string }[] = [
    { label: "Page", value: issue.pageUrl || "-" },
    { label: "DOM", value: issue.selector },
  ];
  if (issue.selectionSnapshot) {
    rows.push({
      label: "Viewport",
      value: `${issue.selectionSnapshot.viewport.width}×${issue.selectionSnapshot.viewport.height}`,
    });
  }
  rows.push({
    label: "Captured",
    value: new Date(issue.createdAt).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  return (
    <div className="space-y-0.5 rounded-md border bg-muted/30 p-3 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
          <span className="break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function DocBody({ value }: { value: string }) {
  if (!value.trim()) {
    return <p className="text-sm text-muted-foreground/70">비어 있음</p>;
  }
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {value}
    </div>
  );
}
