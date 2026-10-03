import { expect } from "vitest";
import type { AttachmentResult, SubmissionFile } from "@/types/attachment";

type File = { filename: string; dataUrl: string; displayName?: string };
type Input = { images?: File[]; video?: File; logs?: File[]; attachments?: File[]; inlineImages?: { refId: string; dataUrl: string }[] };

export function preparedInput<T extends Input>(input: T): T & { submissionFiles: SubmissionFile[] } {
  const files: SubmissionFile[] = [];
  const add = (f: File, id: string, kind: SubmissionFile["kind"]) => files.push({ id, kind, filename: f.displayName ?? f.filename, contentType: /^data:([^;,]+)/.exec(f.dataUrl)?.[1] ?? "application/octet-stream", dataUrl: f.dataUrl });
  input.images?.forEach((f, i) => add(f, `capture:${i}`, "capture"));
  if (input.video) add(input.video, "video", "video");
  input.logs?.forEach((f, i) => add(f, i ? `logs:${i}` : "logs", "logs"));
  input.attachments?.forEach((f, i) => add(f, `user:${i}`, "user"));
  input.inlineImages?.forEach((f) => add({ filename: `inline-${f.refId}.webp`, dataUrl: f.dataUrl }, `inline:${f.refId}`, "inline"));
  return { ...input, submissionFiles: files };
}

// Old RPC fixtures describe outcomes by name; attach identities at the mocked transport boundary.
export function echoFileIds(message: unknown, result: unknown): unknown {
  const msg = message as { type: string; files?: { filename: string; fileId?: string }[]; fileId?: string; payload?: { attachments?: { fileId?: string }[] } };
  if (Array.isArray(result) && msg.files) {
    const remaining = [...msg.files];
    return result.map((r) => {
      const at = remaining.findIndex((f) => f.filename === r.filename);
      const f = at < 0 ? undefined : remaining.splice(at, 1)[0];
      return { ...r, ...(f?.fileId ? { fileId: f.fileId } : {}), ...(msg.type === "slack.uploadFiles" && r.ok ? { remoteFileId: r.remoteFileId ?? `remote:${f?.fileId}` } : {}) };
    });
  }
  if (result && typeof result === "object") {
    return { ...result, ...(msg.fileId ? { fileId: msg.fileId } : {}), ...(msg.type === "notion.submitPage" ? { attachedFileIds: msg.payload?.attachments?.map((f) => f.fileId) ?? [] } : {}) };
  }
  return result;
}

export function expectFileOutcome(result: { attachments?: AttachmentResult[] }, kind: "logs" | "media", incomplete: boolean) {
  expect(result.attachments).toBeDefined();
  const files = result.attachments!.filter((r) => kind === "logs" ? r.fileId.startsWith("logs") : /^(capture:|video$|inline:)/.test(r.fileId));
  if (incomplete) expect(files.length).toBeGreaterThan(0);
  expect(files.some((r) => r.delivery !== "attached")).toBe(incomplete);
}
