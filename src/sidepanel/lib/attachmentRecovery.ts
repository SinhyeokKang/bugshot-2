import type { AttachmentResult, SubmissionRecoveryMeta } from "@/types/attachment";
import type { NormalizedSubmitResult } from "@/types/platform";
import { readRecoveryFile } from "@/store/blob-db";
import { submissionPresentation } from "./attachmentResults";
import { triggerDownload } from "./downloadCapture";

export function recoveryScreen(result: Pick<NormalizedSubmitResult, "attachments" | "recovery" | "submissionFailure">) {
  if (result.recovery) return result.recovery.state;
  if (result.submissionFailure) return "partial";
  return submissionPresentation("created", result.attachments ?? []).screen;
}

export function recoveryFileState(result: AttachmentResult | undefined) {
  if (!result || result.delivery === "unknown") return "unknown";
  if (result.delivery === "attached") return result.presentation === "failed" ? "body" : "complete";
  return result.failure?.stage === "link" ? "unlinked" : "failed";
}

export async function downloadRecoveryFile(meta: SubmissionRecoveryMeta, fileId: string): Promise<boolean> {
  const file = meta.files.find((file) => file.id === fileId);
  if (!file || meta.localFilesRemoved) return false;
  const blob = await readRecoveryFile(meta, fileId);
  if (!blob) return false;
  triggerDownload(blob, file.filename);
  return true;
}
