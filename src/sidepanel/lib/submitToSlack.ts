import { buildSlackBody } from "./buildSlackBody";
import { splitSlackText } from "./splitSlackText";
import { escapeMrkdwn } from "./markdownToMrkdwn";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/types/messages";
import type {
  SlackPermalinkResult,
  SlackPostResult,
  SlackUploadResult,
} from "@/types/slack";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface SlackFileInput {
  filename: string;
  dataUrl: string;
  displayName?: string;
}

export interface SlackSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: SlackFileInput[];
  video?: SlackFileInput;
  logs?: SlackFileInput[];
  attachments?: SlackFileInput[];
  inlineImages?: InlineImageInput[];
  channelId: string;
  mentions?: { id: string; name: string }[];
}

function toUploadEntry(f: SlackFileInput) {
  return {
    filename: f.filename,
    dataUrl: f.dataUrl,
  };
}

export async function submitToSlack(
  input: SlackSubmitInput,
): Promise<NormalizedSubmitResult> {
  const logs = input.logs ?? [];
  const inlineFiles = (input.inlineImages ?? []).map((img) => ({
    filename: `inline-${img.refId}.webp`,
    dataUrl: img.dataUrl,
  }));
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

  const parent = await sendBg<SlackPostResult>({
    type: "slack.postMessage",
    payload: { channelId: input.channelId, text: parentText },
  });

  // 상세 본문은 스레드 답글로 — 채널 타임라인은 제목만 남는다.
  // 4000자를 넘으면 Slack이 임의로 쪼개 코드블럭 펜스를 깨므로, 펜스를 보존해 직접 나눠 보낸다.
  for (const text of splitSlackText(buildSlackBody({ ctx: input.ctx }).body)) {
    await sendBg<SlackPostResult>({
      type: "slack.postMessage",
      payload: { channelId: input.channelId, text, threadTs: parent.ts },
    });
  }

  let logsDropped = false;
  if (allFiles.length > 0) {
    const results = await sendBg<SlackUploadResult[]>({
      type: "slack.uploadFiles",
      channelId: input.channelId,
      threadTs: parent.ts,
      files: allFiles.map(toUploadEntry),
    });
    const okByName = new Map(results.map((r) => [r.filename, r.ok]));
    logsDropped = logs.some((l) => !okByName.get(l.filename));
  }

  const { permalink } = await sendBg<SlackPermalinkResult>({
    type: "slack.getPermalink",
    channelId: input.channelId,
    ts: parent.ts,
  });

  return { key: parent.ts, url: permalink, logsDropped };
}
