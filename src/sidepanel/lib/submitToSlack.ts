import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, submitCreation, type DeliveryResponse, type SubmissionAdapterInput } from "./submissionAdapter";
import { buildSlackBody } from "./buildSlackBody";
import { splitSlackText } from "./splitSlackText";
import { escapeMrkdwn } from "./markdownToMrkdwn";
import { toInlineUploadFiles } from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/lib/bg-client";
import type {
  SlackCompleteResult,
  SlackPermalinkResult,
  SlackPostResult,
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

// Byte length from the base64 payload without decoding it (120s video would be decoded twice).
function base64ByteLength(dataUrl: string): number {
  const marker = dataUrl.indexOf(";base64,");
  if (!dataUrl.startsWith("data:") || marker < 0) throw new Error("Invalid data URL");
  const payload = dataUrl.slice(marker + ";base64,".length);
  return Math.floor((payload.length * 3) / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
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

  // grant → bytes → complete, one bytes message per file. The file ID is stored before bytes and
  // the complete intent before complete, which runs once and is never repeated on ambiguity.
  const responses: DeliveryResponse[] = [];
  const granted: Array<{ fileId?: string; id: string; title: string }> = [];
  for (const file of allFiles) {
    // Before complete Slack discards the upload, so any pre-complete failure is safe to redo.
    const failed = async (error: unknown) => {
      responses.push({ fileId: file.fileId, filename: file.filename, ok: false, failure: safeAttachmentFailure(error) });
      // The allocated id is discarded with the upload, so it must not look reusable.
      if (file.fileId) await input.progress?.fileCheckpoint({ fileId: file.fileId, upload: "failed", uploaded: undefined });
    };
    let allocation: { fileId: string; uploadUrl: string };
    try {
      allocation = await sendBg<{ fileId: string; uploadUrl: string }>({
        type: "slack.requestFileUpload",
        ...(file.fileId ? { fileId: file.fileId } : {}),
        filename: file.filename,
        length: base64ByteLength(file.dataUrl),
      });
      if (!allocation?.fileId || !allocation.uploadUrl) throw new Error("Invalid Slack upload allocation");
    } catch (error) { await failed(error); continue; }
    const fileId = allocation.fileId;
    if (file.fileId) await input.progress?.fileCheckpoint({ fileId: file.fileId, upload: "pending", uploaded: { platform: "slack", id: fileId } });
    try {
      await sendBg({ type: "slack.sendFileUpload", ...(file.fileId ? { fileId: file.fileId } : {}), uploadUrl: allocation.uploadUrl, filename: file.filename, dataUrl: file.dataUrl });
    } catch (error) { await failed(error); continue; }
    if (file.fileId) await input.progress?.fileCheckpoint({ fileId: file.fileId, upload: "done" });
    granted.push({ fileId: file.fileId, id: fileId, title: file.filename });
  }
  if (granted.length > 0) {
    const tracked = granted.filter((g) => g.fileId).map((g) => g.fileId!);
    if (tracked.length) await input.progress?.fileCheckpoint(...tracked.map((fileId) => ({ fileId, link: "unknown" as const })));
    let complete: SlackCompleteResult;
    try {
      complete = await sendBg<SlackCompleteResult>({ type: "slack.completeFileUploads", channelId: input.channelId, threadTs: parent.ts, files: granted.map(({ id, title }) => ({ id, title })) });
    } catch (error) {
      complete = { ok: false, outcome: "ambiguous", failure: safeAttachmentFailure(error, "link") };
    }
    const link = complete.ok ? "done" as const : complete.outcome === "failed" ? "failed" as const : "unknown" as const;
    if (tracked.length) await input.progress?.fileCheckpoint(...tracked.map((fileId) => ({ fileId, link })));
    for (const g of granted) {
      responses.push(complete.ok
        ? { fileId: g.fileId, filename: g.title, ok: true, href: g.id }
        : { fileId: g.fileId, filename: g.title, ok: false, failure: { ...complete.failure, stage: "link" }, ambiguous: complete.outcome === "ambiguous" });
    }
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
  return { ...(permalinkFailed ? { submissionFailure: permalinkFailure } : {}), key: parent.ts, url: permalinkFailed ? "" : permalink, attachments: deliveryResults(input.submissionFiles ?? [], responses.map((r) => ({ ...r, ...(permalinkFailed ? { presentation: "failed" as const, ...(r.ok ? { failure: permalinkFailure } : {}) } : {}) })), permalinkFailed) };
}
