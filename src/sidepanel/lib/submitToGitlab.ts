import {
  buildGitlabIssueBody,
  type GitlabMediaInput,
} from "./buildGitlabIssueBody";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import { sendBg } from "@/types/messages";
import type { GitlabCreateIssueResult } from "@/types/gitlab";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";

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
  cc?: string[];
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
    Array<{ filename: string; url: string | null }>
  >({
    type: "gitlab.uploadFiles",
    projectId: input.projectId,
    files: allFiles.map(toUploadEntry),
  });

  const urlMap = new Map(uploadResults.map((r) => [r.filename, r.url]));
  const logsDropped = (input.logs ?? []).some((l) => !urlMap.get(l.filename));

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

  const { body } = buildGitlabIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: logs.map(toMedia),
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
