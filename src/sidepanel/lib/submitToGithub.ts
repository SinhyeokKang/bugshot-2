import {
  buildGithubIssueBody,
  type GithubMediaInput,
} from "./buildGithubIssueBody";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
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
  inlineImages?: InlineImageInput[];
  owner: string;
  repo: string;
  label?: string;
  assignee?: string;
}

function githubFilename(name: string): string {
  return name.endsWith(".har") ? name.replace(/\.har$/, ".json") : name;
}

function guessMime(filename: string): string {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".html")) return "text/html";
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
  const imageInputs = input.images ?? [];
  const logs = [...(input.logs ?? []), buildAiMetaAttachment(input.ctx)];
  const inlineFiles = (input.inlineImages ?? []).map((img) => ({
    filename: `inline-${img.refId}.webp`,
    dataUrl: img.dataUrl,
  }));
  const allFiles = [
    ...imageInputs,
    ...(input.video ? [input.video] : []),
    ...logs,
    ...inlineFiles,
  ];

  const uploadResults = await sendBg<Array<{ filename: string; href: string | null }>>({
    type: "github.uploadFiles",
    owner: input.owner,
    repo: input.repo,
    files: allFiles.map(toUploadEntry),
  });

  const hrefMap = new Map(uploadResults.map((r) => [r.filename, r.href]));

  let resolvedCtx = input.ctx;
  if (inlineFiles.length > 0) {
    const refToUrl = new Map<string, string>();
    for (const img of input.inlineImages ?? []) {
      const href = hrefMap.get(`inline-${img.refId}.webp`);
      if (href) refToUrl.set(img.refId, href);
    }
    if (refToUrl.size > 0) {
      resolvedCtx = {
        ...input.ctx,
        sections: Object.fromEntries(
          Object.entries(input.ctx.sections).map(([k, v]) => [
            k,
            replaceInlineRefs(v, refToUrl),
          ]),
        ),
      };
    }
  }

  function toMedia(f: GithubFileInput): GithubMediaInput {
    const name = githubFilename(f.filename);
    return {
      filename: name,
      contentType: guessMime(name),
      url: hrefMap.get(name) ?? undefined,
    };
  }

  const { body } = buildGithubIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: logs.map(toMedia),
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
  return { key: `#${result.number}`, url: result.url };
}
