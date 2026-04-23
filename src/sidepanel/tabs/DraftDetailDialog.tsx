import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Loader2, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  AssigneeField,
  EpicField,
  FieldRow,
  IssueTypeField,
  PriorityField,
} from "./IssueCreateModal";

type SubmitFields = {
  issueTypeId?: string;
  assigneeId?: string;
  priorityId?: string;
  parentKey?: string;
  relatesKey?: string;
};

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; result: JiraSubmitResult }
  | { status: "error"; message: string };

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
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    if (!open) return;
    setFields({ issueTypeId: jiraConfig?.issueTypeId });
    setSubmit({ status: "idle" });
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

  const canSubmit =
    configured &&
    !!fields.issueTypeId &&
    submit.status !== "submitting";

  const hasStyleBlock =
    !!issue.snapshot.before || !!issue.snapshot.after || diffs.length > 0;

  async function handleSubmit() {
    if (!issue) return;
    if (!jiraConfig?.auth || !jiraConfig.projectKey) return;
    if (!fields.issueTypeId) return;

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

    setSubmit({ status: "submitting" });
    try {
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
      setSubmit({ status: "success", result });
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

  function handleDelete() {
    if (!issue) return;
    removeIssue(issue.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] max-h-[85vh] gap-5 overflow-y-auto rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {submit.status === "success" ? "이슈가 생성되었습니다" : "초안 검토"}
          </DialogTitle>
        </DialogHeader>

        {submit.status === "success" ? (
          <SuccessView
            result={submit.result}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <div className="flex flex-col gap-4">
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

            {issue.draft.expectedResult ? (
              <FieldSection label="기대 결과">
                <DocBody value={issue.draft.expectedResult} />
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

            {configured ? (
              <div className="flex flex-col gap-3 border-t pt-4">
                <Label className="text-sm font-medium">Jira 필드</Label>
                <FieldRow label="이슈 타입">
                  <IssueTypeField
                    value={fields.issueTypeId}
                    onChange={(id) =>
                      setFields((f) => ({ ...f, issueTypeId: id }))
                    }
                  />
                </FieldRow>
                <FieldRow label="담당자">
                  <AssigneeField
                    value={fields.assigneeId}
                    onChange={(id) =>
                      setFields((f) => ({ ...f, assigneeId: id }))
                    }
                  />
                </FieldRow>
                <FieldRow label="우선순위">
                  <PriorityField
                    value={fields.priorityId}
                    onChange={(id) =>
                      setFields((f) => ({ ...f, priorityId: id }))
                    }
                  />
                </FieldRow>
                <FieldRow label="부모 에픽">
                  <EpicField
                    value={fields.parentKey}
                    onChange={(k) =>
                      setFields((f) => ({ ...f, parentKey: k }))
                    }
                  />
                </FieldRow>
                <FieldRow label="연결 에픽">
                  <EpicField
                    value={fields.relatesKey}
                    onChange={(k) =>
                      setFields((f) => ({ ...f, relatesKey: k }))
                    }
                  />
                </FieldRow>
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  설정 탭에서 Jira를 먼저 연결하세요.
                </AlertDescription>
              </Alert>
            )}

            {submit.status === "error" ? (
              <Alert variant="destructive" className="text-xs">
                <AlertDescription>{submit.message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="mt-2 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={submit.status === "submitting"}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 />
                삭제
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={submit.status === "submitting"}
                >
                  닫기
                </Button>
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                >
                  {submit.status === "submitting" ? (
                    <>
                      <Loader2 className="animate-spin" />
                      생성 중...
                    </>
                  ) : (
                    "이슈 제출"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

function SuccessView({
  result,
  onClose,
}: {
  result: JiraSubmitResult;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border bg-muted/40 px-4 py-3">
        <div className="text-xs text-muted-foreground">이슈 키</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-base font-medium">{result.key}</span>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Jira에서 열기
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>닫기</Button>
      </div>
    </div>
  );
}
