import {
  buildGithubIssueBody,
  type GithubMediaInput,
} from "./buildGithubIssueBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { sendBg } from "@/types/messages";
import type { GithubCreateIssueResult } from "@/types/github";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface GithubSubmitInput {
  ctx: MarkdownContext;
  images?: GithubMediaInput[];
  video?: GithubMediaInput;
  logs?: GithubMediaInput[];
  owner: string;
  repo: string;
  label?: string;
  assignees?: string[];
}

export async function submitToGithub(
  input: GithubSubmitInput,
): Promise<NormalizedSubmitResult> {
  const { body } = buildGithubIssueBody({
    ctx: input.ctx,
    images: input.images,
    video: input.video,
    logs: input.logs,
  });
  const result = await sendBg<GithubCreateIssueResult>({
    type: "github.submitIssue",
    payload: {
      owner: input.owner,
      repo: input.repo,
      title: input.ctx.title.trim(),
      body,
      labels: input.label ? [input.label] : undefined,
      assignees: input.assignees?.length ? input.assignees : undefined,
    },
  });
  return { key: `#${result.number}`, url: result.url };
}
