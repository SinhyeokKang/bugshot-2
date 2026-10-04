import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Download, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { readRecoveryFile, readSubmissionRecovery } from "@/store/blob-db";
import { useIssuesStore } from "@/store/issues-store";
import type { SubmissionRecoveryMeta } from "@/types/attachment";
import { downloadRecoveryFile, recoveryFileState } from "@/sidepanel/lib/attachmentRecovery";
import { RETRY_REASON_KEY, retrySummaryText, retryUiState } from "@/sidepanel/lib/retryUi";
import { useRetryAccount, useRetrySession } from "@/sidepanel/lib/retrySession";
import { deleteSubmissionLocalFiles, confirmSubmissionNotRegistered } from "@/sidepanel/lib/submissionRecovery";
import { Section } from "./Section";

export function AttachmentRecoveryPanel({ issueId, attemptId, allowManage = false, onConfirmed, onMetaLoaded }: {
  issueId: string; attemptId: string; allowManage?: boolean; onConfirmed?: () => void; onMetaLoaded?: (meta: SubmissionRecoveryMeta) => void;
}) {
  const t = useT();
  const issue = useIssuesStore((s) => s.issues.find((i) => i.id === issueId));
  const [meta, setMeta] = useState<SubmissionRecoveryMeta | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const session = useRetrySession(issueId);
  const locked = busy || session.running;
  const account = useRetryAccount(meta?.platform ?? "");
  const reason = retryUiState(meta, session.stop, account).reason;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void (async () => {
      const current = await readSubmissionRecovery(issueId);
      if (!current || current.attemptId !== attemptId) throw new Error("Recovery unavailable");
      const absent = new Set<string>();
      for (const file of current.files) {
        if (recoveryFileState(current.results.find((r) => r.fileId === file.id)) === "complete") continue;
        if (current.localFilesRemoved || !(await readRecoveryFile(current, file.id))) absent.add(file.id);
      }
      if (!cancelled) { setMeta(current); setMissing(absent); onMetaLoaded?.(current); }
    })().catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [issueId, attemptId, issue, revision, onMetaLoaded, session.finishedAt]);

  async function download(fileId: string) {
    if (!meta || busy) return;
    setBusy(true); setError(false);
    try {
      if (!(await downloadRecoveryFile(meta, fileId))) setMissing((old) => new Set([...old, fileId]));
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  async function manage(action: "delete" | "confirm") {
    if (!meta || locked) return;
    setBusy(true); setError(false);
    try {
      if (action === "delete") {
        await deleteSubmissionLocalFiles(issueId, attemptId);
        if (meta.destination) onConfirmed?.();
        else setRevision((n) => n + 1);
      }
      else { await confirmSubmissionNotRegistered(issueId, attemptId); onConfirmed?.(); }
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  const incomplete = meta?.files.filter((f) => recoveryFileState(meta.results.find((r) => r.fileId === f.id)) !== "complete") ?? [];
  const complete = meta?.files.filter((f) => !incomplete.includes(f)) ?? [];
  const row = (file: SubmissionRecoveryMeta["files"][number]) => {
    const result = meta!.results.find((r) => r.fileId === file.id);
    const state = recoveryFileState(result);
    const progress = session.progress[file.id];
    const conflicted = meta!.retry?.checkpoints.find((c) => c.fileId === file.id)?.body === "conflict" && result?.failure?.stage === "body";
    return <Card key={file.id} className="flex min-w-0 items-start gap-3 p-3" data-testid="recovery-file-row" data-file-id={file.id} data-state={result?.delivery ?? "unknown"}>
      {state === "complete" ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium" title={file.filename}>{file.filename}</p>
        <p className="text-xs text-muted-foreground">{t(`recovery.kind.${file.kind}`)}</p>
        <p className="break-words text-sm">{t(`recovery.state.${state}`)}</p>
        {progress && <p className="flex items-center gap-1.5 break-words text-xs" data-testid="recovery-file-progress">{progress.state === "running" && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}{t(`recovery.retry.stage.${progress.stage}`)} · {t(`recovery.retry.progress.${progress.state}`)}</p>}
        {result?.failure && <p className="break-words text-xs text-muted-foreground">{conflicted ? t("recovery.retry.fileConflict") : t(`recovery.reason.${result.failure.code}`)}</p>}
        {state !== "complete" && (meta!.localFilesRemoved || missing.has(file.id) ? <p className="text-sm" data-testid="recovery-local-missing">{t("recovery.localMissing")}</p> :
          <Button variant="outline" size="sm" data-testid="recovery-file-download" aria-label={`${t("recovery.download")} ${file.filename}`} aria-disabled={busy} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-foreground" onClick={() => void download(file.id)}><Download className="h-4 w-4" />{t("recovery.download")}</Button>)}
      </div>
    </Card>;
  };
  return <div className="min-w-0 space-y-3" aria-busy={busy || loading}>
    {allowManage && <p role="status" aria-live="polite" data-testid="recovery-retry-status" className={session.summary ? "break-words text-sm" : "sr-only"}>{session.summary ? retrySummaryText(session.summary, t) : ""}</p>}
    {loading && !meta && <p role="status" className="text-sm text-muted-foreground">{t("recovery.loading")}</p>}
    {error && <p role="alert" className="break-words text-sm">{t("recovery.error")}</p>}
    {meta && <>
      {meta.phase === "complete" && <p className="break-words text-sm">{t("recovery.storageFailed")}</p>}
      {meta.submissionFailure && <p className="break-words text-sm">{t("recovery.submissionFailed")} {t(`recovery.reason.${meta.submissionFailure.code}`)}</p>}
      {!meta.destination && <p className="text-sm">{t("recovery.unknownBody")}</p>}
      <p className="text-sm text-muted-foreground">{meta.localFilesRemoved ? t("recovery.localMissing") : t("recovery.retention", { n: Math.max(0, Math.ceil((meta.expiresAt - Date.now()) / 86_400_000)) })}</p>
      {allowManage && incomplete.length > 0 && reason && reason !== "local-missing" && <p className="flex items-start gap-1.5 break-words text-sm" data-testid="recovery-retry-notice" data-reason={reason}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" /><span className="min-w-0">{t(RETRY_REASON_KEY[reason])}</span></p>}
      {incomplete.map(row)}
      {complete.length > 0 && <Section collapsible defaultOpen={false} title={t("recovery.completed", { n: complete.length })}><div className="space-y-3">{complete.map(row)}</div></Section>}
      {allowManage && <div className="flex flex-wrap gap-2">
        {(meta.phase === "partial" || meta.phase === "unknown") && (!meta.localFilesRemoved || !!meta.destination) && <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="destructive-outline" size="sm" className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-destructive" data-testid="recovery-delete-local" aria-disabled={locked} onClick={(event) => { if (locked) event.preventDefault(); }}>{t("recovery.deleteLocal")}</Button></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("recovery.deleteLocal")}</AlertDialogTitle><AlertDialogDescription>{t("recovery.deleteBody")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("common.close")}</AlertDialogCancel><AlertDialogAction onClick={() => void manage("delete")}>{t("recovery.deleteLocal")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>}
        {meta.phase === "unknown" && !meta.destination && <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="outline" size="sm" className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-foreground" data-testid="recovery-confirm-not-registered" aria-disabled={locked} onClick={(event) => { if (locked) event.preventDefault(); }}>{t("recovery.confirmNotRegistered")}</Button></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("recovery.confirmNotRegistered")}</AlertDialogTitle><AlertDialogDescription>{t("recovery.confirmBody")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("common.close")}</AlertDialogCancel><AlertDialogAction onClick={() => void manage("confirm")}>{t("recovery.confirmNotRegistered")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>}
      </div>}
    </>}
  </div>;
}
