import { describe, expect, it } from "vitest";
import { reconcileAttachmentResults, attachmentFailureCode, submissionPresentation, legacyAttachmentDrops } from "../attachmentResults";
import type { AttachmentResult, SubmissionFile } from "@/types/attachment";

const files: SubmissionFile[] = [
  { id: "logs", kind: "logs", filename: "logs.html", contentType: "text/html", dataUrl: "" },
  { id: "user:a", kind: "user", filename: "logs.html", contentType: "text/html", dataUrl: "" },
];
const attached = (fileId: string) => ({ fileId, delivery: "attached" as const, presentation: "complete" as const, locator: "remote-id" });

describe("attachment result contracts", () => {
  it("matches stable IDs, never filenames, and separates user files from logs", () => {
    const results = reconcileAttachmentResults(files, [attached("logs")]);
    expect(results.map((r) => r.delivery)).toEqual(["attached", "unknown"]);
    expect(legacyAttachmentDrops(files, results)).toEqual({ logsDropped: false, mediaDropped: false });
  });
  it("treats missing, duplicate and empty locator evidence conservatively", () => {
    for (const evidence of [[], [attached("logs"), attached("logs")], [{ ...attached("logs"), locator: "  " }]]) {
      expect(reconcileAttachmentResults(files.slice(0, 1), evidence)).toEqual([
        { fileId: "logs", delivery: "unknown", presentation: "failed", failure: { stage: "upload", code: "invalid-response" } },
      ]);
    }
  });
  it("distinguishes link failure, body failure after attachment, and intentional exclusion", () => {
    const link: AttachmentResult = { fileId: "logs", delivery: "failed", presentation: "not-applicable", failure: { stage: "link", code: "permission" } };
    const body = { ...attached("user:a"), presentation: "failed" as const, failure: { stage: "body" as const, code: "unknown" as const } };
    expect(reconcileAttachmentResults(files, [link, body])).toEqual([link, { ...body, locator: undefined }]);
    expect(reconcileAttachmentResults([], [attached("logs")])).toEqual([]);
    expect(submissionPresentation("created", [body])).toEqual({ screen: "partial", showPanel: true, showToast: false });
  });
  it("does not guess size from permission or unstructured messages", () => {
    expect(attachmentFailureCode({ httpStatus: 403, message: "too large" })).toBe("permission");
    expect(attachmentFailureCode({ message: "size limit" })).toBe("unknown");
    expect(attachmentFailureCode({ httpStatus: 413 })).toBe("size-limit");
  });
  it("uses only the completion panel for partial and unknown results", () => {
    expect(submissionPresentation("unknown", [])).toEqual({ screen: "unknown", showPanel: true, showToast: false });
    expect(submissionPresentation("created", [])).toEqual({ screen: "success", showPanel: false, showToast: false });
    expect(submissionPresentation("created", reconcileAttachmentResults(files, []))).toEqual({ screen: "partial", showPanel: true, showToast: false });
  });
});
