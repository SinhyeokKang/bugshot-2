import type {
  WebhookMediaEntry,
  WebhookMediaKind,
  WebhookSubmitPayload,
} from "@/types/webhook";
import type { CaptureFile, CaptureFiles } from "./buildCaptureFiles";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { emitMarkdownLogSummary } from "./issueBodyShared";
import { guessUploadMime } from "./uploadMime";

export interface BuildWebhookPayloadInput {
  ctx: MarkdownContext;
  // 이미 cid: 참조로 해소된 본문. buildMarkdownIssueBody의 출력이다.
  body: string;
  files: CaptureFiles;
  // 인라인 이미지는 CaptureFiles 축이 아니라 prepareUpload가 본문 참조로 바꾼 별도 축이다.
  // 여기 안 실으면 본문의 cid:inline-*가 대응 파트 없는 고아 참조가 된다.
  inlineFiles?: CaptureFile[];
  idempotencyKey: string;
  sentAt: number;
  version: string;
}

// 파트 이름은 buildCaptureFiles의 filename을 그대로 쓴다. 본문의 cid: 참조가 같은 문자열을
// 가리키므로 여기서 이름을 다시 만들면 그 순간 둘이 갈린다.
function toEntry(file: CaptureFile, kind: WebhookMediaKind): WebhookMediaEntry {
  return {
    part: file.filename,
    // 사용자 첨부만 표시명이 따로 있다. 원본명을 보내야 수신 서버 UI에 고유화 접두사가 안 뜬다.
    filename: file.displayName ?? file.filename,
    contentType: guessUploadMime(file.filename),
    kind,
  };
}

export function logSummaryText(ctx: MarkdownContext): string | undefined {
  const lines: string[] = [];
  // 본문 8빌더가 각자 이 판정을 복제했다가 액션 로그 단독 케이스를 빠뜨린 전례가 있다
  // (POSTMORTEM 2026-06-25). 공용 헬퍼를 그대로 쓰고 자체 판정을 두지 않는다.
  emitMarkdownLogSummary(lines, ctx);
  return lines.length > 0 ? lines.join("\n").trim() : undefined;
}

export function buildWebhookPayload(input: BuildWebhookPayloadInput): WebhookSubmitPayload {
  const { ctx, body, files } = input;

  const media: WebhookMediaEntry[] = [
    ...files.images.map((f) => toEntry(f, "image")),
    ...(files.video ? [toEntry(files.video, "video")] : []),
    ...(input.inlineFiles ?? []).map((f) => toEntry(f, "inline")),
    ...files.logs.map((f) => toEntry(f, "logs")),
    ...files.attachments.map((f) => toEntry(f, "attachment")),
  ];

  return {
    title: ctx.title,
    body,
    environment: filterEnvironmentRows(ctx.environment),
    logSummary: logSummaryText(ctx),
    media,
    bugshot: {
      version: input.version,
      sentAt: input.sentAt,
      idempotencyKey: input.idempotencyKey,
    },
  };
}
