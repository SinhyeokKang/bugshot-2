import { buildGithubIssueBody } from "./buildGithubIssueBody";
import { prepareUpload, type UploadFileInput } from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/types/messages";
import type { GithubCreateIssueResult } from "@/types/github";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export type GithubFileInput = UploadFileInput;

export interface GithubSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: GithubFileInput[];
  video?: GithubFileInput;
  logs?: GithubFileInput[];
  attachments?: GithubFileInput[];
  inlineImages?: InlineImageInput[];
  owner: string;
  repo: string;
  label?: string;
  assignee?: string;
  cc?: string[];
  requireMediaUpload?: boolean;
}

export async function submitToGithub(
  input: GithubSubmitInput,
): Promise<NormalizedSubmitResult> {
  const prepared = await prepareUpload(
    input,
    (files) =>
      sendBg<Array<{ filename: string; href: string | null }>>({
        type: "github.uploadFiles",
        owner: input.owner,
        repo: input.repo,
        files,
      }),
    { platform: "github" },
  );
  const { resolvedCtx, toMedia, toAttachmentMedia, logsDropped } = prepared;

  const imageInputs = input.images ?? [];
  const { body } = buildGithubIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: (input.logs ?? []).map(toMedia),
    attachments: (input.attachments ?? []).map(toAttachmentMedia),
    cc: input.cc,
  });

  const result = await sendBg<GithubCreateIssueResult>({
    type: "github.submitIssue",
    payload: {
      owner: input.owner,
      repo: input.repo,
      title: input.ctx.title.trim(),
      body,
      labels: input.label ? [input.label] : undefined,
      assignees: input.assignee ? [input.assignee] : undefined,
    },
  });
  return { key: `#${result.number}`, url: result.url, logsDropped };
}
