import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, submitCreation, type SubmissionAdapterInput } from "./submissionAdapter";
import { buildSlackBody } from "./buildSlackBody";
import { splitSlackText } from "./splitSlackText";
import { escapeMrkdwn } from "./markdownToMrkdwn";
import { toInlineUploadFiles } from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/lib/bg-client";
import type {
  SlackPermalinkResult,
  SlackPostResult,
  SlackUploadResult,
} from "@/types/slack";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface SlackFileInput {
  fileId?: string;
  contentType?: string;
  filename: string;
  dataUrl: string;
  displayName?: string;
}

export interface SlackSubmitInput extends SubmissionAdapterInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: SlackFileInput[];
  video?: SlackFileInput;
  logs?: SlackFileInput[];
  attachments?: SlackFileInput[];
  inlineImages?: InlineImageInput[];
  channelId: string;
  mentions?: { id: string; name: string }[];
}

// prepareUpload의 공용판을 쓰지 않는다 — slack.uploadFiles 페이로드는 {filename, dataUrl}뿐이라
// 공용판이 얹는 contentType이 쓰이지 않은 채 메시지 경계를 넘는다.
function toUploadEntry(f: SlackFileInput) {
  return {
    ...(f.fileId ? { fileId: f.fileId } : {}),
    filename: f.filename,
    dataUrl: f.dataUrl,
  };
}

export async function submitToSlack(
  input: SlackSubmitInput,
): Promise<NormalizedSubmitResult> {
  input = bindSubmissionFiles(input);
  const logs = input.logs ?? [];
  const inlineFiles = toInlineUploadFiles(input.inlineImages);
  const allFiles = [
    ...(input.images ?? []),
    ...(input.video ? [input.video] : []),
    ...logs,
    ...inlineFiles,
    ...(input.attachments ?? []),
  ];

  // 제목(+멘션)은 부모 메시지, 멘션은 호명자에게 알림이 가도록 부모에만 넣는다.
  const mentionLine = (input.mentions ?? []).map((m) => `<@${m.id}>`).join(" ");
  const safeTitle = escapeMrkdwn(input.ctx.title.trim());
  const parentText = mentionLine ? `*${safeTitle}*\n${mentionLine}` : `*${safeTitle}*`;

  const parent = await submitCreation(input.progress, () => sendBg<SlackPostResult>({
    type: "slack.postMessage",
    payload: { channelId: input.channelId, text: parentText },
  }));
  await input.progress?.created({ platform: "slack", key: parent.ts, locator: { channelId: input.channelId, ts: parent.ts } });

  // 상세 본문은 스레드 답글로 — 채널 타임라인은 제목만 남는다.
  // 4000자를 넘으면 Slack이 임의로 쪼개 코드블럭 펜스를 깨므로, 펜스를 보존해 직접 나눠 보낸다.
  for (const text of splitSlackText(buildSlackBody({ ctx: input.ctx }).body)) {
    await sendBg<SlackPostResult>({
      type: "slack.postMessage",
      payload: { channelId: input.channelId, text, threadTs: parent.ts },
    });
  }

  let responses: SlackUploadResult[] = [];
  let logsDropped = false;
  let mediaDropped = false;
  if (allFiles.length > 0) {
    // 사용자 첨부를 뺀 캡처 미디어 — jira의 `!att.userAttachment`, asana의 위치 경계와
    // 같은 의미론이다. 사용자 첨부 실패는 이 축이 아니다.
    const mediaFiles = [
      ...(input.images ?? []),
      ...(input.video ? [input.video] : []),
      ...inlineFiles,
    ];
    const results = await sendBg<SlackUploadResult[]>({
      type: "slack.uploadFiles",
      channelId: input.channelId,
      threadTs: parent.ts,
      files: allFiles.map(toUploadEntry),
    }).catch((error) => allFiles.map((f) => ({ fileId: f.fileId, filename: f.filename, ok: false as const, failure: safeAttachmentFailure(error) })));
    responses = results;
    const okByName = new Map(allFiles.map((f) => { const found = results.filter((r) => f.fileId ? r.fileId === f.fileId : r.filename === f.filename); return [f.fileId ?? f.filename, found.length === 1 && found[0].ok]; }));
    logsDropped = logs.some((l) => !okByName.get(l.fileId ?? l.filename));
    mediaDropped = mediaFiles.some((f) => !okByName.get(f.fileId ?? f.filename));
  }

  let permalinkFailure: import("@/types/attachment").AttachmentResult["failure"];
  const permalinkResult = await sendBg<SlackPermalinkResult>({
    type: "slack.getPermalink",
    channelId: input.channelId,
    ts: parent.ts,
  }).catch((error) => { permalinkFailure = safeAttachmentFailure(error, "body"); return { permalink: "" }; });

  const permalink = permalinkResult?.permalink;
  try {
    const url = new URL(permalink);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid permalink");
  } catch { permalinkFailure ??= { stage: "body", code: "invalid-response" }; }
  const permalinkFailed = !!permalinkFailure;
  return { ...(permalinkFailed ? { submissionFailure: permalinkFailure } : {}), key: parent.ts, url: permalinkFailed ? "" : permalink, logsDropped, mediaDropped, ...(input.submissionFiles ? { attachments: deliveryResults(input.submissionFiles, responses.map((r) => ({ ...r, href: r.remoteFileId, ...(permalinkFailed ? { presentation: "failed" as const, ...(r.ok ? { failure: permalinkFailure } : {}) } : {}) })), permalinkFailed) } : {}) };
}
