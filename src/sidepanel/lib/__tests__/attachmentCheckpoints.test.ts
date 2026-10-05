import { describe, expect, it } from "vitest";
import type { SubmissionRecoveryMeta } from "@/types/attachment";
import { failedStageState, initialAttachmentCheckpoints, mergeCheckpoint, retrySnapshotBlocker } from "../attachmentCheckpoints";

const kinds = ["capture", "video", "inline", "logs", "user"] as const;
const files = kinds.map((kind) => ({ id: kind === "user" ? "user:a" : kind, kind }));
const stages = (platform: Parameters<typeof initialAttachmentCheckpoints>[0]) =>
  Object.fromEntries(initialAttachmentCheckpoints(platform, files).map((cp) => [cp.fileId, `${cp.upload}/${cp.link}/${cp.body}`]));

describe("initialAttachmentCheckpoints", () => {
  it("starts every upload pending without a locator", () => {
    for (const cp of initialAttachmentCheckpoints("github", files)) expect(cp).not.toHaveProperty("uploaded");
  });

  it.each([
    ["github", { capture: "pending/not-applicable/pending", video: "pending/not-applicable/pending", inline: "pending/not-applicable/pending", logs: "pending/not-applicable/pending", "user:a": "pending/not-applicable/pending" }],
    ["gitlab", { capture: "pending/not-applicable/pending", video: "pending/not-applicable/pending", inline: "pending/not-applicable/pending", logs: "pending/not-applicable/pending", "user:a": "pending/not-applicable/pending" }],
    ["jira", { capture: "pending/not-applicable/pending", video: "pending/not-applicable/pending", inline: "pending/not-applicable/pending", logs: "pending/not-applicable/pending", "user:a": "pending/not-applicable/not-applicable" }],
    ["linear", { capture: "pending/not-applicable/pending", video: "pending/not-applicable/pending", inline: "pending/not-applicable/pending", logs: "pending/pending/pending", "user:a": "pending/pending/not-applicable" }],
    ["notion", { capture: "pending/pending/not-applicable", video: "pending/pending/not-applicable", inline: "pending/pending/not-applicable", logs: "pending/pending/not-applicable", "user:a": "pending/pending/not-applicable" }],
    ["asana", { capture: "pending/not-applicable/pending", video: "pending/not-applicable/not-applicable", inline: "pending/not-applicable/pending", logs: "pending/not-applicable/pending", "user:a": "pending/not-applicable/not-applicable" }],
    ["clickup", { capture: "pending/not-applicable/pending", video: "pending/not-applicable/pending", inline: "pending/not-applicable/pending", logs: "pending/not-applicable/pending", "user:a": "pending/not-applicable/not-applicable" }],
    ["slack", { capture: "pending/pending/not-applicable", video: "pending/pending/not-applicable", inline: "pending/pending/not-applicable", logs: "pending/pending/not-applicable", "user:a": "pending/pending/not-applicable" }],
  ] as const)("%s follows the provider attach/body table", (platform, expected) => {
    expect(stages(platform)).toEqual(expected);
  });
});

describe("failedStageState", () => {
  it.each([
    [{ stage: "upload", code: "permission", httpStatus: 403 }, "failed"],
    [{ stage: "upload", code: "size-limit", httpStatus: 413 }, "failed"],
    [{ stage: "body", code: "unknown", httpStatus: 400 }, "failed"],
    [{ stage: "upload", code: "network" }, "unknown"],
    [{ stage: "upload", code: "not-sent" }, "failed"],
    [{ stage: "upload", code: "timeout", httpStatus: 408 }, "unknown"],
    [{ stage: "body", code: "unknown", httpStatus: 502 }, "unknown"],
    [{ stage: "upload", code: "unknown" }, "unknown"],
    [undefined, "unknown"],
  ] as const)("classifies %j as %s", (failure, state) => {
    expect(failedStageState(failure)).toBe(state);
  });
});

describe("retrySnapshotBlocker", () => {
  const partial = (patch: Partial<SubmissionRecoveryMeta> = {}): SubmissionRecoveryMeta => ({
    attemptId: "a", issueId: "i", title: "t", platform: "github", createdAt: 1, expiresAt: 2, updatedAt: 1, phase: "partial", files: [], results: [],
    destination: { platform: "github", key: "#1", locator: { owner: "o", repo: "r", number: "1" } },
    retry: { schemaVersion: 1, accountIdentity: '["github","1"]', bodyLocale: "en", revision: 3, checkpoints: [], bodyPlan: { format: "markdown", lastWritten: "", replacements: [] } },
    ...patch,
  });

  it("allows a partial record with a verified snapshot", () => {
    expect(retrySnapshotBlocker(partial())).toBeNull();
  });

  it("keeps phase-one records without a snapshot download-only", () => {
    expect(retrySnapshotBlocker(partial({ retry: undefined }))).toBe("legacy");
  });

  it("fails closed when the account identity was not verified", () => {
    expect(retrySnapshotBlocker(partial({ retry: { ...partial().retry!, accountIdentity: null } }))).toBe("account-unverified");
  });

  it("reports removed local files, webhook and unsettled creation", () => {
    expect(retrySnapshotBlocker(partial({ localFilesRemoved: true }))).toBe("local-missing");
    expect(retrySnapshotBlocker(partial({ platform: "webhook", destination: { platform: "webhook", key: "k", locator: { key: "k", url: "https://hook.example/k" } }, retry: undefined }))).toBe("webhook-unsupported");
    expect(retrySnapshotBlocker(partial({ phase: "unknown", destination: undefined }))).toBe("ambiguous");
  });
});

describe("mergeCheckpoint", () => {
  it("overlays a patch and drops fields set to undefined", () => {
    expect(mergeCheckpoint({ fileId: "a", upload: "pending", link: "pending", body: "not-applicable", uploaded: { platform: "slack", id: "F" } }, { fileId: "a", upload: "failed", uploaded: undefined }))
      .toStrictEqual({ fileId: "a", upload: "failed", link: "pending", body: "not-applicable" });
  });

  it("refuses a file without a checkpoint", () => {
    expect(() => mergeCheckpoint(undefined, { fileId: "x", upload: "done" })).toThrow();
  });
});
