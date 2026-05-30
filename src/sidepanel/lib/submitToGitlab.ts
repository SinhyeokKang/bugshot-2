import {
  buildGitlabIssueBody,
  type GitlabMediaInput,
} from "./buildGitlabIssueBody";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/types/messages";
import type { GitlabCreateIssueResult } from "@/types/gitlab";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface GitlabFileInput {
  filename: string;
  dataUrl: string;
}

export interface GitlabSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: GitlabFileInput[];
  video?: GitlabFileInput;
  logs?: GitlabFileInput[];
  inlineImages?: InlineImageInput[];
  projectId: number;
  label?: string;
  assigneeId?: number;
}

function gitlabFilename(name: string): string {
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

function toUploadEntry(f: GitlabFileInput) {
  const name = gitlabFilename(f.filename);
  return { filename: name, contentType: guessMime(name), dataUrl: f.dataUrl };
}

export async function submitToGitlab(
  input: GitlabSubmitInput,
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

  const uploadResults = await sendBg<
    Array<{ filename: string; markdown: string | null; url: string | null }>
  >({
    type: "gitlab.uploadFiles",
    projectId: input.projectId,
    files: allFiles.map(toUploadEntry),
  });

  const urlMap = new Map(uploadResults.map((r) => [r.filename, r.url]));

  let resolvedCtx = input.ctx;
  if (inlineFiles.length > 0) {
    const refToUrl = new Map<string, string>();
    for (const img of input.inlineImages ?? []) {
      const url = urlMap.get(`inline-${img.refId}.webp`);
      if (url) refToUrl.set(img.refId, url);
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

  function toMedia(f: GitlabFileInput): GitlabMediaInput {
    const name = gitlabFilename(f.filename);
    return {
      filename: name,
      contentType: guessMime(name),
      url: urlMap.get(name) ?? undefined,
    };
  }

  const { body } = buildGitlabIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: logs.map(toMedia),
  });

  const result = await sendBg<GitlabCreateIssueResult>({
    type: "gitlab.submitIssue",
    payload: {
      projectId: input.projectId,
      title: input.ctx.title.trim(),
      description: body,
      labels: input.label ? [input.label] : undefined,
      assigneeIds: input.assigneeId ? [input.assigneeId] : undefined,
    },
  });
  return { key: `#${result.iid}`, url: result.url };
}
