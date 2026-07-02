import {
  buildMarkdownIssueBody,
  type MarkdownIssueBuildInput,
  type MarkdownIssueBuildResult,
  type MarkdownMediaInput,
} from "./buildMarkdownIssueBody";

export type GitlabMediaInput = MarkdownMediaInput;
export type GitlabBuildInput = MarkdownIssueBuildInput;
export type GitlabBuildResult = MarkdownIssueBuildResult;

export function buildGitlabIssueBody(
  input: GitlabBuildInput,
): GitlabBuildResult {
  // GitLab은 video도 이미지 문법(![](url))으로 임베드 — 기본 videoEmbed.
  return buildMarkdownIssueBody(input, { platform: "gitlab" });
}
