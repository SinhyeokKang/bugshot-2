import {
  buildMarkdownIssueBody,
  type MarkdownIssueBuildInput,
  type MarkdownIssueBuildResult,
} from "./buildMarkdownIssueBody";

export type GitlabBuildInput = MarkdownIssueBuildInput;

export function buildGitlabIssueBody(
  input: GitlabBuildInput,
): MarkdownIssueBuildResult {
  // GitLab은 video도 이미지 문법(![](url))으로 임베드 — 기본 videoEmbed.
  return buildMarkdownIssueBody(input, { platform: "gitlab" });
}
