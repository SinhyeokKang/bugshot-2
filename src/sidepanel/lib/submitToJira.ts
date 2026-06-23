import { buildIssueAdf } from "./buildIssueAdf";
import { annotateAttachmentDimensions } from "./attachmentDimensions";
import type { MarkdownContext } from "./buildIssueMarkdown";
import type { CaptureFile } from "./buildCaptureFiles";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/types/messages";
import type { JiraAttachmentInput, JiraSubmitResult } from "@/types/jira";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface JiraSubmitInput {
  ctx: MarkdownContext;
  inlineImages?: InlineImageInput[];
  images?: CaptureFile[];
  video?: CaptureFile;
  logs?: CaptureFile[];
  attachments?: CaptureFile[];
  projectKey: string;
  summary: string;
  issueTypeId: string;
  assigneeAccountId?: string;
  priorityId?: string;
  parentKey?: string;
  relatesKey?: string;
  cc?: { accountId: string; displayName: string }[];
}

export async function submitToJira(input: JiraSubmitInput): Promise<NormalizedSubmitResult> {
  const inlineImages = input.inlineImages ?? [];
  const rawAttachments: JiraAttachmentInput[] = [
    ...(input.images ?? []),
    ...(input.video ? [input.video] : []),
    ...(input.logs ?? []),
  ];
  for (const img of inlineImages) {
    rawAttachments.push({ filename: `inline-${img.refId}.webp`, dataUrl: img.dataUrl });
  }
  // 사용자 첨부: Jira는 업로드 시 attachment 영역에 자동 등록(본문 placeholder 불필요). 표시명=원본.
  for (const a of input.attachments ?? []) {
    rawAttachments.push({ filename: a.displayName ?? a.filename, dataUrl: a.dataUrl });
  }
  const attachments = await annotateAttachmentDimensions(rawAttachments);

  const result = await sendBg<JiraSubmitResult>({
    type: "jira.submitIssue",
    payload: {
      projectKey: input.projectKey,
      summary: input.summary,
      description: buildIssueAdf(input.ctx, inlineImages.map((i) => i.refId), input.cc),
      issueTypeId: input.issueTypeId,
      assigneeAccountId: input.assigneeAccountId,
      priorityId: input.priorityId,
      parentKey: input.parentKey,
    },
    attachments,
    relatesKey: input.relatesKey,
  });
  return { key: result.key, url: result.url, logsDropped: result.logsDropped };
}
