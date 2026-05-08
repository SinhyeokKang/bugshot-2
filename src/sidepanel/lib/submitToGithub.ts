import {
  buildGithubIssueBody,
  type GithubMediaInput,
} from "./buildGithubIssueBody";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { sendBg } from "@/types/messages";
import type { GithubCreateIssueResult } from "@/types/github";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface GithubFileInput {
  filename: string;
  dataUrl: string;
}

export interface GithubSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: GithubFileInput[];
  video?: GithubFileInput;
  logs?: GithubFileInput[];
  owner: string;
  repo: string;
  label?: string;
  assignees?: string[];
}

function githubFilename(name: string): string {
  return name.endsWith(".har") ? name.replace(/\.har$/, ".json") : name;
}

function guessMime(filename: string): string {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".md")) return "text/markdown";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function toUploadEntry(f: GithubFileInput) {
  const name = githubFilename(f.filename);
  return { filename: name, contentType: guessMime(name), dataUrl: f.dataUrl };
}

export async function submitToGithub(
  input: GithubSubmitInput,
): Promise<NormalizedSubmitResult> {
  const aiMeta = buildAiMetaAttachment(input.ctx);

  const imageInputs = input.images ?? [];
  const logInputs = input.logs ?? [];
  const allFiles = [
    ...imageInputs,
    ...(input.video ? [input.video] : []),
    ...logInputs,
    aiMeta,
  ];

  const uploadResults = await sendBg<Array<{ filename: string; href: string | null }>>({
    type: "github.uploadFiles",
    owner: input.owner,
    repo: input.repo,
    files: allFiles.map(toUploadEntry),
  });

  const hrefMap = new Map(uploadResults.map((r) => [r.filename, r.href]));

  function toMedia(f: GithubFileInput): GithubMediaInput {
    const name = githubFilename(f.filename);
    return {
      filename: name,
      contentType: guessMime(name),
      url: hrefMap.get(name) ?? undefined,
    };
  }

  const { body } = buildGithubIssueBody({
    ctx: input.ctx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: [...logInputs, aiMeta].map(toMedia),
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
