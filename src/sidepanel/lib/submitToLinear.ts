import {
  buildLinearIssueBody,
  type LinearMediaInput,
} from "./buildLinearIssueBody";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { sendBg } from "@/types/messages";
import type { LinearCreateIssueResult } from "@/types/linear";
import type { NormalizedSubmitResult } from "@/types/platform";

export interface LinearFileInput {
  filename: string;
  dataUrl: string;
}

export interface LinearSubmitInput {
  ctx: MarkdownContext;
  images?: LinearFileInput[];
  video?: LinearFileInput;
  logs?: LinearFileInput[];
  teamId: string;
  projectId?: string;
  labelId?: string;
  assigneeId?: string;
  priority?: number;
}

function guessMime(filename: string): string {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".md")) return "text/markdown";
  if (filename.endsWith(".har")) return "application/json";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function uploadFile(file: LinearFileInput): Promise<LinearMediaInput> {
  const { assetUrl } = await sendBg<{ assetUrl: string }>({
    type: "linear.uploadFile",
    filename: file.filename,
    contentType: guessMime(file.filename),
    dataUrl: file.dataUrl,
  });
  return { filename: file.filename, assetUrl };
}

export async function submitToLinear(
  input: LinearSubmitInput,
): Promise<NormalizedSubmitResult> {
  const uploadPromises: Promise<LinearMediaInput>[] = [];
  const imageIndexes = input.images ?? [];
  for (const img of imageIndexes) uploadPromises.push(uploadFile(img));
  const videoPromise = input.video ? uploadFile(input.video) : null;
  const logFiles = input.logs ?? [];
  const logPromises = logFiles.map((l) => uploadFile(l));

  const [imageResults, videoResult, ...logResults] = await Promise.all([
    Promise.all(uploadPromises),
    videoPromise,
    ...logPromises,
  ]);

  const { body } = buildLinearIssueBody({
    ctx: input.ctx,
    images: imageResults,
    video: videoResult ?? undefined,
  });

  const result = await sendBg<LinearCreateIssueResult>({
    type: "linear.submitIssue",
    payload: {
      teamId: input.teamId,
      title: input.ctx.title.trim(),
      description: body,
      projectId: input.projectId,
      labelId: input.labelId,
      assigneeId: input.assigneeId,
      priority: input.priority,
    },
  });

  const aiMeta = buildAiMetaAttachment(input.ctx);
  const aiMetaUploaded = await uploadFile(aiMeta);

  const attachments = [
    ...logResults.filter((log) => log.assetUrl),
    ...(aiMetaUploaded.assetUrl ? [aiMetaUploaded] : []),
  ];
  await Promise.all(
    attachments.map((att) =>
      sendBg({
        type: "linear.createAttachment",
        issueId: result.id,
        title: att.filename,
        url: att.assetUrl!,
      }),
    ),
  );

  return { key: result.identifier, url: result.url };
}
