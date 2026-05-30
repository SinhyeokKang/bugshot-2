import { buildAsanaIssueBody, type AsanaMediaInput } from "./buildAsanaIssueBody";
import { markdownToAsanaHtml } from "./markdownToAsanaHtml";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { sendBg } from "@/types/messages";
import type { AsanaCreateTaskResult } from "@/types/asana";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface AsanaFileInput {
  filename: string;
  dataUrl: string;
}

export interface AsanaSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: AsanaFileInput[];
  video?: AsanaFileInput;
  logs?: AsanaFileInput[];
  workspaceGid: string;
  projectGid?: string;
  assigneeGid?: string;
}

function asanaFilename(name: string): string {
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

function toUploadEntry(f: AsanaFileInput) {
  const name = asanaFilename(f.filename);
  return { filename: name, contentType: guessMime(name), dataUrl: f.dataUrl };
}

function toMedia(f: AsanaFileInput): AsanaMediaInput {
  const name = asanaFilename(f.filename);
  return { filename: name, contentType: guessMime(name) };
}

export async function submitToAsana(
  input: AsanaSubmitInput,
): Promise<NormalizedSubmitResult> {
  const imageInputs = input.images ?? [];
  const logs = [...(input.logs ?? []), buildAiMetaAttachment(input.ctx)];
  const allFiles = [
    ...imageInputs,
    ...(input.video ? [input.video] : []),
    ...logs,
  ];

  const { body } = buildAsanaIssueBody({
    ctx: input.ctx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: logs.map(toMedia),
  });
  const htmlNotes = markdownToAsanaHtml(body);

  // Asana attachment는 parent task gid가 필수 → createTask 먼저, 그다음 첨부 (Jira 패턴).
  const task = await sendBg<AsanaCreateTaskResult>({
    type: "asana.submitIssue",
    payload: {
      workspaceGid: input.workspaceGid,
      projectGid: input.projectGid,
      name: input.ctx.title.trim(),
      htmlNotes,
      assigneeGid: input.assigneeGid,
    },
  });

  if (allFiles.length > 0) {
    // per-file 격리는 background 핸들러가 처리 (개별 실패 시 gid null) — task는 보존.
    await sendBg<Array<{ filename: string; gid: string | null }>>({
      type: "asana.uploadFiles",
      parent: task.gid,
      files: allFiles.map(toUploadEntry),
    });
  }

  return { key: task.gid, url: task.permalinkUrl };
}
