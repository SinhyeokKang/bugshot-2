import {
  buildClickupIssueBody,
  type ClickupMediaInput,
} from "./buildClickupIssueBody";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import { sendBg } from "@/types/messages";
import type { ClickupCreateTaskResult } from "@/types/clickup";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface ClickupFileInput {
  filename: string;
  dataUrl: string;
  // 사용자 첨부: 업로드 식별용 filename(고유)과 본문 표시명(원본) 분리.
  displayName?: string;
}

export interface ClickupSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: ClickupFileInput[];
  video?: ClickupFileInput;
  logs?: ClickupFileInput[];
  attachments?: ClickupFileInput[];
  inlineImages?: InlineImageInput[];
  listId: string;
  assigneeId?: string;
  cc?: { id: string; name?: string }[];
}

function toUploadEntry(f: ClickupFileInput) {
  return {
    filename: f.filename,
    contentType: guessUploadMime(f.filename),
    dataUrl: f.dataUrl,
  };
}

export async function submitToClickup(
  input: ClickupSubmitInput,
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

  // CC는 본문 markdown `@텍스트`로 주입 (ClickUp은 markdown 멘션 미지원이라 사람이 읽을
  // 이름을 쓴다 — 알림은 안 가지만 누구를 참조하는지 본문에 남는다. name 없으면 id 폴백).
  const cc = (input.cc ?? []).map((u) => u.name ?? u.id);

  // ClickUp attachment는 task id가 필수 → 먼저 task를 만든다. 이 시점엔 첨부 URL이 없어
  // 미디어가 본문에 인라인되지 않고, 업로드 후 2차 갱신으로 인라인한다 (Asana 패턴).
  // 사용자 첨부·로그파일·영상은 네이티브 task 첨부로만 가고 본문 나열은 안 한다.
  function toMedia(f: ClickupFileInput, urlMap?: Map<string, string | null>): ClickupMediaInput {
    return {
      filename: f.filename,
      contentType: guessUploadMime(f.filename),
      url: urlMap?.get(f.filename) ?? undefined,
    };
  }

  const buildBody = (
    ctx: ClickupSubmitInput["ctx"],
    urlMap?: Map<string, string | null>,
  ) =>
    buildClickupIssueBody({
      ctx,
      images: imageInputs.length > 0 ? imageInputs.map((f) => toMedia(f, urlMap)) : undefined,
      video: input.video ? toMedia(input.video, urlMap) : undefined,
      logs: logs.map((f) => toMedia(f, urlMap)),
      cc,
    }).body;

  const body1 = buildBody(input.ctx);
  const task = await sendBg<ClickupCreateTaskResult>({
    type: "clickup.submitIssue",
    payload: {
      listId: input.listId,
      name: input.ctx.title.trim(),
      markdownContent: body1,
      assignees: input.assigneeId ? [input.assigneeId] : undefined,
    },
  });

  let logsDropped = false;
  if (allFiles.length > 0) {
    // task URL을 이미 알고 있으니 logs.html에 백링크를 미리 주입해 1회 업로드로 끝낸다.
    const uploadFiles = await Promise.all(
      allFiles.map(async (f) =>
        f.filename === "logs.html"
          ? { ...f, dataUrl: await injectIssueUrl(f.dataUrl, task.url, task.id) }
          : f,
      ),
    );

    const results = await sendBg<Array<{ filename: string; url: string | null }>>({
      type: "clickup.uploadFile",
      taskId: task.id,
      files: uploadFiles.map(toUploadEntry),
    });

    const urlMap = new Map(results.map((r) => [r.filename, r.url]));
    logsDropped = logs.some((l) => !urlMap.get(l.filename));

    // 본문 붙여넣기 인라인 이미지: 업로드 URL로 본문 src(`inline:refId`)를 치환.
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

    // 업로드 URL을 반영해 본문을 재구성 → 인라인 렌더. 변경 있을 때만 2차 PUT.
    const body2 = buildBody(resolvedCtx, urlMap);
    if (body2 !== body1) {
      try {
        await sendBg({
          type: "clickup.updateTaskMarkdown",
          taskId: task.id,
          markdownContent: body2,
        });
      } catch {
        // 본문 갱신 실패해도 task·첨부는 보존 (이미지는 task 첨부로 남음).
      }
    }
  }

  return { key: task.id, url: task.url, logsDropped };
}
