import {
  buildMarkdownIssueBody,
  type MarkdownIssueBuildInput,
  type MarkdownIssueBuildResult,
  type MarkdownMediaInput,
} from "./buildMarkdownIssueBody";

export type GithubMediaInput = MarkdownMediaInput;
export type GithubBuildInput = MarkdownIssueBuildInput;
export type GithubBuildResult = MarkdownIssueBuildResult;

export function buildGithubIssueBody(
  input: GithubBuildInput,
): GithubBuildResult {
  return buildMarkdownIssueBody(input, {
    platform: "github",
    // GitHub은 bare URL이어야 비디오 플레이어가 자동 임베드된다.
    videoEmbed: (m) => m.url,
  });
}
