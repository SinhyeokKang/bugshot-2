import {
  buildGithubIssueBody,
  type GithubMediaInput,
} from "./buildGithubIssueBody";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import { t } from "@/i18n";
import { sendBg } from "@/types/messages";
import type { GithubCreateIssueResult } from "@/types/github";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface GithubFileInput {
  filename: string;
  dataUrl: string;
  // 사용자 첨부: 업로드 식별용 filename(고유)과 본문 표시명(원본) 분리.
  displayName?: string;
}

export interface GithubSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: GithubFileInput[];
  video?: GithubFileInput;
  logs?: GithubFileInput[];
  attachments?: GithubFileInput[];
  inlineImages?: InlineImageInput[];
  owner: string;
  repo: string;
  label?: string;
  assignee?: string;
  cc?: string[];
  // 승격(Slack 보존 이슈)처럼 성공 시 원본을 파괴하는 흐름에서는 미디어 업로드가
  // 하나라도 누락되면 이슈 생성 전에 중단해 원본 손실을 막는다. 로그는 best-effort라 제외.
  requireMediaUpload?: boolean;
}

// hrefMap에서 기대 파일 중 업로드 누락(href 부재)이 있는지.
export function someUploadMissing(
  filenames: string[],
  hrefMap: Map<string, string | null>,
): boolean {
  return filenames.some((f) => !hrefMap.get(f));
}

function toUploadEntry(f: GithubFileInput) {
  return {
    filename: f.filename,
    contentType: guessUploadMime(f.filename),
    dataUrl: f.dataUrl,
  };
}

export async function submitToGithub(
  input: GithubSubmitInput,
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

  const uploadResults = await sendBg<Array<{ filename: string; href: string | null }>>({
    type: "github.uploadFiles",
    owner: input.owner,
    repo: input.repo,
    files: allFiles.map(toUploadEntry),
  });

  const hrefMap = new Map(uploadResults.map((r) => [r.filename, r.href]));
  const logsDropped = (input.logs ?? []).some((l) => !hrefMap.get(l.filename));

  if (input.requireMediaUpload) {
    const requiredMedia = [
      ...imageInputs,
      ...(input.video ? [input.video] : []),
      ...inlineFiles,
      ...userAttachments,
    ].map((f) => f.filename);
    if (someUploadMissing(requiredMedia, hrefMap)) {
      throw new Error(t("github.error.mediaUploadFailed"));
    }
  }

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
    return {
      filename: f.filename,
      contentType: guessUploadMime(f.filename),
      url: hrefMap.get(f.filename) ?? undefined,
    };
  }

  // 사용자 첨부: 본문 표시명은 원본(displayName), url 매칭은 업로드 filename(고유).
  function toAttachmentMedia(f: GithubFileInput): GithubMediaInput {
    const name = f.displayName ?? f.filename;
    return {
      filename: name,
      contentType: guessUploadMime(name),
      url: hrefMap.get(f.filename) ?? undefined,
    };
  }

  const { body } = buildGithubIssueBody({
    ctx: resolvedCtx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
    video: input.video ? toMedia(input.video) : undefined,
    logs: logs.map(toMedia),
    attachments: userAttachments.map(toAttachmentMedia),
    cc: input.cc,
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
  return { key: `#${result.number}`, url: result.url, logsDropped };
}
