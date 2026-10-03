import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, submitCreation, uploadCheckpoints, type SubmissionAdapterInput } from "./submissionAdapter";
import type { UploadFileResult } from "@/types/messages";
import { buildGitlabIssueBody } from "./buildGitlabIssueBody";
import {
  prepareUpload,
  toUploadEntry,
  type UploadFileInput,
} from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/lib/bg-client";
import type { GitlabCreateIssueResult } from "@/types/gitlab";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";

export type { NormalizedSubmitResult } from "@/types/platform";

export type GitlabFileInput = UploadFileInput;

export interface GitlabSubmitInput extends SubmissionAdapterInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: GitlabFileInput[];
  video?: GitlabFileInput;
  logs?: GitlabFileInput[];
  attachments?: GitlabFileInput[];
  inlineImages?: InlineImageInput[];
  projectId: number;
  label?: string;
  assigneeId?: number;
  cc?: string[];
  requireMediaUpload?: boolean;
}

export async function submitToGitlab(
  input: GitlabSubmitInput,
): Promise<NormalizedSubmitResult> {
  input = bindSubmissionFiles(input);
  // 판별자 union → prepareUpload의 href 형태로 정규화해 공용 헬퍼에 주입.
  const prepared = await prepareUpload(
    input,
    async (files) => {
      const results = await sendBg<UploadFileResult[]>({
        type: "gitlab.uploadFiles",
        projectId: input.projectId,
        files,
      }).catch((error) => files.map((f) => ({ fileId: f.fileId, filename: f.filename, ok: false as const, failure: safeAttachmentFailure(error) })));
      return results.map((r) => ({ fileId: r.fileId, failure: r.failure, filename: r.filename, href: r.ok ? r.href : null }));
    },
    { platform: "gitlab" },
  );
  const { resolvedCtx, toMedia, toAttachmentMedia, hrefMap } = prepared;
  const uploads = uploadCheckpoints(input.submissionFiles ?? [], prepared.responses, (r) => r.href ? { platform: "gitlab", href: r.href } : undefined);
  if (uploads.length) await input.progress?.fileCheckpoint(...uploads);

  const imageInputs = input.images ?? [];
  const { body } = buildGitlabIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: (input.logs ?? []).map(toMedia),
    attachments: (input.attachments ?? []).map(toAttachmentMedia),
    cc: input.cc,
  });

  const result = await submitCreation(input.progress, () => sendBg<GitlabCreateIssueResult>({
    type: "gitlab.submitIssue",
    payload: {
      projectId: input.projectId,
      title: input.ctx.title.trim(),
      description: body,
      labels: input.label ? [input.label] : undefined,
      assigneeIds: input.assigneeId ? [input.assigneeId] : undefined,
    },
  }));
  await input.progress?.created({ platform: "gitlab", key: `#${result.iid}`, url: result.url, locator: { projectId: String(input.projectId), iid: String(result.iid) } });
  await input.progress?.bodyWritten(body, ...uploads.filter((u) => u.upload === "done").map((u) => ({ fileId: u.fileId, body: "done" as const })));

  // 이슈 생성 후 logs.html에 이슈 역링크를 주입해 재업로드하고 description의 URL을 교체.
  // GitLab은 업로드→생성 순서라 생성 시점엔 이슈 URL이 없음. 보강 실패는 제출을 깨지 않게 격리.
  const logsHtml = (input.logs ?? []).find((l) => l.filename === "logs.html");
  const oldLogsUrl = hrefMap.get(logsHtml?.fileId ?? "logs.html");
  if (logsHtml && oldLogsUrl) {
    // The old upload stays valid and referenced until the description swap succeeds, so the
    // re-upload is recorded only together with the body that points at it.
    let swapped: { description: string; href: string } | undefined;
    try {
      const augmented = await injectIssueUrl(
        logsHtml.dataUrl,
        result.url,
        `#${result.iid}`,
      );
      const [reUploaded] = await sendBg<UploadFileResult[]>({
        type: "gitlab.uploadFiles",
        projectId: input.projectId,
        files: [toUploadEntry({ fileId: logsHtml.fileId, filename: "logs.html", dataUrl: augmented })],
      });
      if (reUploaded?.ok && reUploaded.href && reUploaded.href !== oldLogsUrl) {
        const description = body.split(oldLogsUrl).join(reUploaded.href);
        await sendBg({
          type: "gitlab.updateIssueDescription",
          projectId: input.projectId,
          iid: result.iid,
          description,
        });
        swapped = { description, href: reUploaded.href };
      }
    } catch {
      // 보강 실패: 이슈는 이미 생성됨 — 역링크 없는 logs.html로 둔다.
    }
    if (swapped && logsHtml.fileId) await input.progress?.bodyWritten(swapped.description, { fileId: logsHtml.fileId, uploaded: { platform: "gitlab", href: swapped.href } });
  }

  return { key: `#${result.iid}`, url: result.url, attachments: deliveryResults(input.submissionFiles ?? [], prepared.responses) };
}
