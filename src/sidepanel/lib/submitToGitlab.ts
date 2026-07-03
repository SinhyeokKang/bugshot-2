import { buildGitlabIssueBody } from "./buildGitlabIssueBody";
import {
  prepareUpload,
  toUploadEntry,
  type UploadFileInput,
} from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/types/messages";
import type { GitlabCreateIssueResult } from "@/types/gitlab";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";

export type { NormalizedSubmitResult } from "@/types/platform";

export type GitlabFileInput = UploadFileInput;

export interface GitlabSubmitInput {
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
  // gitlab.uploadFiles는 { url } 형태 반환 — href로 정규화해 공용 헬퍼에 주입.
  const prepared = await prepareUpload(
    input,
    async (files) => {
      const results = await sendBg<Array<{ filename: string; url: string | null }>>({
        type: "gitlab.uploadFiles",
        projectId: input.projectId,
        files,
      });
      return results.map((r) => ({ filename: r.filename, href: r.url ?? null }));
    },
    { platform: "gitlab" },
  );
  const { resolvedCtx, toMedia, toAttachmentMedia, logsDropped, hrefMap } = prepared;

  const imageInputs = input.images ?? [];
  const { body } = buildGitlabIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: (input.logs ?? []).map(toMedia),
    attachments: (input.attachments ?? []).map(toAttachmentMedia),
    cc: input.cc,
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

  // 이슈 생성 후 logs.html에 이슈 역링크를 주입해 재업로드하고 description의 URL을 교체.
  // GitLab은 업로드→생성 순서라 생성 시점엔 이슈 URL이 없음. 보강 실패는 제출을 깨지 않게 격리.
  const logsHtml = (input.logs ?? []).find((l) => l.filename === "logs.html");
  const oldLogsUrl = hrefMap.get("logs.html");
  if (logsHtml && oldLogsUrl) {
    try {
      const augmented = await injectIssueUrl(
        logsHtml.dataUrl,
        result.url,
        `#${result.iid}`,
      );
      const [reUploaded] = await sendBg<Array<{ filename: string; url: string | null }>>({
        type: "gitlab.uploadFiles",
        projectId: input.projectId,
        files: [toUploadEntry({ filename: "logs.html", dataUrl: augmented })],
      });
      if (reUploaded?.url && reUploaded.url !== oldLogsUrl) {
        await sendBg({
          type: "gitlab.updateIssueDescription",
          projectId: input.projectId,
          iid: result.iid,
          description: body.split(oldLogsUrl).join(reUploaded.url),
        });
      }
    } catch {
      // 보강 실패: 이슈는 이미 생성됨 — 역링크 없는 logs.html로 둔다.
    }
  }

  return { key: `#${result.iid}`, url: result.url, logsDropped };
}
