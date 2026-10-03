import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionRecoveryMeta } from "@/types/attachment";
const { readRecoveryFile, triggerDownload } = vi.hoisted(() => ({ readRecoveryFile: vi.fn(), triggerDownload: vi.fn() }));
vi.mock("@/store/blob-db", () => ({ readRecoveryFile }));
vi.mock("../downloadCapture", () => ({ triggerDownload }));
import { downloadRecoveryFile, recoveryScreen, recoveryFileState } from "../attachmentRecovery";
const meta: SubmissionRecoveryMeta = { issueId: "i", attemptId: "a", title: "Report", platform: "notion", phase: "partial", createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 10000, results: [], files: [
  { id: "logs", kind: "logs", filename: "logs.zip", contentType: "application/zip", source: { kind: "generated", key: "file:a:logs" } },
  { id: "user:1", kind: "user", filename: "logs.zip", contentType: "application/pdf", source: { kind: "original", store: "attachments", key: "i:1" } },
] };
beforeEach(() => vi.clearAllMocks());
describe("recovery presentation and downloads", () => {
  it("keeps authoritative recovery even with no failed files", () => {
    expect(recoveryScreen({ attachments: [], recovery: { state: "partial", storageFailed: true, issueId: "i", attemptId: "a" } })).toBe("partial");
    expect(recoveryScreen({ attachments: [], submissionFailure: { stage: "body", code: "network" } })).toBe("partial");
    expect(recoveryScreen({ attachments: [], recovery: { state: "unknown", issueId: "i", attemptId: "a" } })).toBe("unknown");
    expect(recoveryScreen({ attachments: [] })).toBe("success");
  });
  it("distinguishes attachment, linking, body and ambiguous results", () => {
    expect(recoveryFileState(undefined)).toBe("unknown");
    expect(recoveryFileState({ fileId: "f", delivery: "failed", presentation: "failed", failure: { stage: "link", code: "unknown" } })).toBe("unlinked");
    expect(recoveryFileState({ fileId: "f", delivery: "attached", presentation: "failed" })).toBe("body");
  });
  it("downloads frozen bytes and filename by ID, never colliding display name", async () => {
    const zip = new Blob(["frozen zip"], { type: "application/zip" });
    readRecoveryFile.mockResolvedValue(zip);
    expect(await downloadRecoveryFile(meta, "logs")).toBe(true);
    expect(readRecoveryFile).toHaveBeenCalledWith(meta, "logs");
    expect(triggerDownload).toHaveBeenCalledWith(zip, "logs.zip");
    expect(await triggerDownload.mock.calls[0][0].text()).toBe("frozen zip");
  });
  it("never downloads missing, removed or unknown files", async () => {
    readRecoveryFile.mockResolvedValue(null);
    expect(await downloadRecoveryFile(meta, "logs")).toBe(false);
    expect(await downloadRecoveryFile({ ...meta, localFilesRemoved: true }, "logs")).toBe(false);
    expect(await downloadRecoveryFile(meta, "absent")).toBe(false);
    expect(triggerDownload).not.toHaveBeenCalled();
  });
  it("propagates read errors without a fake successful download", async () => {
    readRecoveryFile.mockRejectedValue(new Error("storage"));
    await expect(downloadRecoveryFile(meta, "logs")).rejects.toThrow();
    expect(triggerDownload).not.toHaveBeenCalled();
  });
  it("keeps an Asana JPEG's frozen MIME, extension and bytes", async () => {
    const jpeg = new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" });
    const image: SubmissionRecoveryMeta = { ...meta, files: [{ id: "capture:screenshot", kind: "capture", filename: "screenshot.jpg", contentType: "image/jpeg", source: { kind: "generated", key: "file:a:capture:screenshot" } }] };
    readRecoveryFile.mockResolvedValue(jpeg);
    await downloadRecoveryFile(image, "capture:screenshot");
    const [bytes, name] = triggerDownload.mock.calls[0];
    expect(name).toBe("screenshot.jpg");
    expect(bytes.type).toBe("image/jpeg");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
  });

});
