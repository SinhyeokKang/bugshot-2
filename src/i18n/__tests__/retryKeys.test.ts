import { describe, expect, it } from "vitest";
import { locales } from "../index";
import { LOCALES } from "../locales";

const RETRY_KEYS = [
  "recovery.retry", "recovery.retrying", "recovery.retry.fileConflict",
  "recovery.retry.summary.complete", "recovery.retry.summary.partial", "recovery.retry.summary.needsCheck", "recovery.retry.summary.storageFailed",
  "recovery.retry.stage.upload", "recovery.retry.stage.link", "recovery.retry.stage.body",
  "recovery.retry.progress.running", "recovery.retry.progress.done", "recovery.retry.progress.failed", "recovery.retry.progress.unknown", "recovery.retry.progress.conflict", "recovery.retry.progress.local-missing",
  "recovery.retry.reason.account-changed", "recovery.retry.reason.account-unverified", "recovery.retry.reason.remote-missing", "recovery.retry.reason.permission", "recovery.retry.reason.authentication",
  "recovery.retry.reason.body-conflict", "recovery.retry.reason.ambiguous", "recovery.retry.reason.webhook-unsupported", "recovery.retry.reason.legacy", "recovery.retry.reason.local-missing",
] as const;

describe("attachment retry copy", () => {
  it.each(LOCALES)("%s defines every retry key with a non-empty value", (code) => {
    const dict = locales[code] as Record<string, string>;
    for (const key of RETRY_KEYS) expect(dict[key], `${code}:${key}`).toBeTruthy();
  });

  it.each(LOCALES)("%s keeps the {n} count in the completed and failed summaries", (code) => {
    const dict = locales[code] as Record<string, string>;
    expect(dict["recovery.retry.summary.complete"]).toContain("{n}");
    expect(dict["recovery.retry.summary.partial"]).toContain("{n}");
  });
});
