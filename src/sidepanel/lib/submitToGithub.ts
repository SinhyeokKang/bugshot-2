import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, submitCreation, uploadCheckpoints, type SubmissionAdapterInput } from "./submissionAdapter";
import type { UploadFileResult } from "@/types/messages";
import { buildGithubIssueBody } from "./buildGithubIssueBody";
import { prepareUpload, type UploadFileInput } from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/lib/bg-client";
import type { GithubCreateIssueResult } from "@/types/github";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export type GithubFileInput = UploadFileInput;

export interface GithubSubmitInput extends SubmissionAdapterInput {
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
  input = bindSubmissionFiles(input);
  const prepared = await prepareUpload(
    input,
    async (files) => {
      const results = await sendBg<UploadFileResult[]>({
        type: "github.uploadFiles",
        owner: input.owner,
        repo: input.repo,
        files,
      }).catch((error) => files.map((f) => ({ fileId: f.fileId, filename: f.filename, ok: false as const, failure: safeAttachmentFailure(error) })));
      return results.map((r) => ({ fileId: r.fileId, failure: r.failure, filename: r.filename, href: r.ok ? r.href : null }));
    },
    { platform: "github" },
  );
  const { resolvedCtx, toMedia, toAttachmentMedia } = prepared;
  const uploads = uploadCheckpoints(input.submissionFiles ?? [], prepared.responses, (r) => r.href ? { platform: "github", href: r.href } : undefined);
  if (uploads.length) await input.progress?.fileCheckpoint(...uploads);

  const imageInputs = input.images ?? [];
  const { body } = buildGithubIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: (input.logs ?? []).map(toMedia),
    attachments: (input.attachments ?? []).map(toAttachmentMedia),
    cc: input.cc,
  });

  const result = await submitCreation(input.progress, () => sendBg<GithubCreateIssueResult>({
    type: "github.submitIssue",
    payload: {
      owner: input.owner,
      repo: input.repo,
      title: input.ctx.title.trim(),
      body,
      labels: input.label ? [input.label] : undefined,
      assignees: input.assignee ? [input.assignee] : undefined,
    },
  }));
  await input.progress?.created({ platform: "github", key: `#${result.number}`, url: result.url, locator: { owner: input.owner, repo: input.repo, number: String(result.number) } });
  await input.progress?.bodyWritten(body, ...uploads.filter((u) => u.upload === "done").map((u) => ({ fileId: u.fileId, body: "done" as const })));
  return { key: `#${result.number}`, url: result.url, attachments: deliveryResults(input.submissionFiles ?? [], prepared.responses) };
}
