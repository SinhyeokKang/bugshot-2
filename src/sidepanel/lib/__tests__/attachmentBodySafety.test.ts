import { describe, expect, it } from "vitest";
import { buildGithubIssueBody } from "../buildGithubIssueBody";
import { buildGitlabIssueBody } from "../buildGitlabIssueBody";
import { buildClickupIssueBody } from "../buildClickupIssueBody";
import { buildJiraDescriptionContent } from "@/background/messages";
import { buildIssueAdf } from "../buildIssueAdf";
import type { MarkdownContext } from "../buildIssueMarkdown";
const ctx: MarkdownContext = { bodyLocale: "en", captureMode: "screenshot", title: "Title", sections: { description: "Before ![pic](inline:missing) after" }, sectionConfig: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }], url: "https://example.com", selector: "", tagName: "", classListBefore: [], classListAfter: [], specifiedStyles: {}, tokens: [], viewport: { width: 100, height: 100 }, capturedAt: 1, diffs: [], environment: [], actionLogCaptured: 1 };
describe("external bodies without uploads", () => {
  it.each([buildGithubIssueBody, buildGitlabIssueBody, buildClickupIssueBody])("removes unresolved inline references and does not claim logs are attached", (build) => {
    const { body } = build({ ctx });
    expect(body).not.toContain("inline:");
    expect(body).toContain("file not attached");
    expect(body).not.toContain("BugShot report attached");
  });
  it("sanitizes the initial Jira ADF before any attachment or description update", () => {
    const description = buildIssueAdf(ctx, ["missing"]);
    const content = buildJiraDescriptionContent({ description, uploadMap: new Map(), bodyLocale: "en" });
    expect(JSON.stringify(content)).not.toMatch(/__BUGSHOT_|inline:|BugShot report attached/);
  });
});
