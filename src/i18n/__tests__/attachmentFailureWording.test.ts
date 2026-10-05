import { describe, expect, it } from "vitest";
import { locales } from "../index";
import { LOCALES } from "../locales";

// The body notice is only rendered for files without an uploaded URL, i.e. failed uploads.
// GitHub's copy used to claim inline attachments are unsupported, which misstates the cause (#251).
describe("attachment-not-inline body notice", () => {
  it.each(LOCALES)("%s: GitHub states an upload failure the same way GitLab does", (locale) => {
    const dict = locales[locale] as Record<string, string>;
    expect(dict["github.attachmentNotInline"]).toBe(dict["gitlab.attachmentNotInline"].replaceAll("GitLab", "GitHub"));
    expect(dict["github.attachmentNotInline"]).not.toMatch(/support|지원하지|prend pas en charge/i);
  });
});
