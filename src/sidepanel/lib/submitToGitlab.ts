import {
  buildGitlabIssueBody,
  type GitlabMediaInput,
} from "./buildGitlabIssueBody";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { someUploadMissing } from "./submitToGithub";
import { guessUploadMime } from "./uploadMime";
import { t } from "@/i18n";
import { sendBg } from "@/types/messages";
import type { GitlabCreateIssueResult } from "@/types/gitlab";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface GitlabFileInput {
  filename: string;
  dataUrl: string;
  // 사용자 첨부: 업로드 식별용 filename(고유)과 본문 표시명(원본) 분리.
  displayName?: string;
}

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
  // 승격(Slack 보존 이슈)처럼 성공 시 원본을 파괴하는 흐름에서는 미디어 업로드가
  // 하나라도 누락되면 이슈 생성 전에 중단해 원본 손실을 막는다. 로그는 best-effort라 제외.
  requireMediaUpload?: boolean;
}

function toUploadEntry(f: GitlabFileInput) {
  return {
    filename: f.filename,
    contentType: guessUploadMime(f.filename),
    dataUrl: f.dataUrl,
  };
}

export async function submitToGitlab(
  input: GitlabSubmitInput,
): Promise<NormalizedSubmitResult> {
  const imageInputs = input.images ?? [];
  const logs = input.logs ?? [];
  const userAttachments = input.attachments ?? [];
  const inlineFiles = (input.inlineImages ?? []).map((img) => ({
    filename: `inline-${img.refId}.webp`,
    dataUrl: img.dataUrl,
  }));
  const allFiles = [
    ...imageInputs,
    ...(input.video ? [input.video] : []),
    ...logs,
    ...inlineFiles,
    ...userAttachments,
  ];

  const uploadResults = await sendBg<
    Array<{ filename: string; url: string | null }>
  >({
    type: "gitlab.uploadFiles",
    projectId: input.projectId,
    files: allFiles.map(toUploadEntry),
  });

  const urlMap = new Map(uploadResults.map((r) => [r.filename, r.url]));
  const logsDropped = (input.logs ?? []).some((l) => !urlMap.get(l.filename));

  if (input.requireMediaUpload) {
    const requiredMedia = [
      ...imageInputs,
      ...(input.video ? [input.video] : []),
      ...inlineFiles,
      ...userAttachments,
    ].map((f) => f.filename);
    if (someUploadMissing(requiredMedia, urlMap)) {
      throw new Error(t("gitlab.error.mediaUploadFailed"));
    }
  }

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
    return {
      filename: f.filename,
      contentType: guessUploadMime(f.filename),
      url: urlMap.get(f.filename) ?? undefined,
    };
  }

  function toAttachmentMedia(f: GitlabFileInput): GitlabMediaInput {
    const name = f.displayName ?? f.filename;
    return {
      filename: name,
      contentType: guessUploadMime(name),
      url: urlMap.get(f.filename) ?? undefined,
    };
  }

  const { body } = buildGitlabIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: logs.map(toMedia),
    attachments: userAttachments.map(toAttachmentMedia),
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
  const oldLogsUrl = urlMap.get("logs.html");
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
