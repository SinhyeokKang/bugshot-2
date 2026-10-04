import type { SubmissionFile } from "@/types/attachment";
import { inlineUploadFilename } from "@/lib/inline-ref";

// Byte length from the base64 payload without decoding it (120s video would be decoded twice).
export function base64ByteLength(dataUrl: string): number {
  const marker = dataUrl.indexOf(";base64,");
  if (!dataUrl.startsWith("data:") || marker < 0) throw new Error("Invalid data URL");
  const payload = dataUrl.slice(marker + ";base64,".length);
  return Math.floor((payload.length * 3) / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
}

// Upload-map name the Jira background matches against the description placeholders.
export function jiraBodyFilename(file: Pick<SubmissionFile, "id" | "kind" | "filename">): string {
  return file.id === "capture:screenshot" ? "screenshot.webp"
    : file.kind === "capture" && /^capture:(before|after)-\d+$/.test(file.id) ? `${file.id.slice("capture:".length)}.webp`
    : file.kind === "inline" ? inlineUploadFilename(file.id.slice("inline:".length)) : file.filename;
}
