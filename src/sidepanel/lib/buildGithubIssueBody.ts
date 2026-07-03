import {
  buildMarkdownIssueBody,
  type MarkdownIssueBuildInput,
  type MarkdownIssueBuildResult,
} from "./buildMarkdownIssueBody";

export type GithubBuildInput = MarkdownIssueBuildInput;

export function buildGithubIssueBody(
  input: GithubBuildInput,
): MarkdownIssueBuildResult {
  return buildMarkdownIssueBody(input, {
    platform: "github",
    // GitHub은 bare URL이어야 비디오 플레이어가 자동 임베드된다.
    videoEmbed: (m) => m.url,
  });
}
