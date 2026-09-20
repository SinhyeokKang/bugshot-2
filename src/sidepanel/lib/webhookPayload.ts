import type {
  WebhookMediaEntry,
  WebhookMediaKind,
  WebhookSubmitPayload,
} from "@/types/webhook";
import type { CaptureFile, CaptureFiles } from "./buildCaptureFiles";
import { issueEnvironmentRows, type MarkdownContext } from "./buildIssueMarkdown";
import { withLocale } from "@/i18n";
import { logCountSummary } from "./issueBodyShared";
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

// 실제 파트의 Content-Type은 dataUrlToBlob이 dataUrl에서 읽는다. 메타데이터를 파일명
// 추측으로만 만들면 둘이 갈린다 — guessUploadMime은 pdf·zip 같은 첨부를 모른다.
export function contentTypeOf(file: CaptureFile): string {
  const m = /^data:([^;,]+)[;,]/.exec(file.dataUrl);
  return m?.[1] ?? guessUploadMime(file.filename);
}

// 파트 이름은 buildCaptureFiles의 filename을 그대로 쓴다. 본문의 cid: 참조가 같은 문자열을
// 가리키므로 여기서 이름을 다시 만들면 그 순간 둘이 갈린다.
function toEntry(file: CaptureFile, kind: WebhookMediaKind): WebhookMediaEntry {
  return {
    part: file.filename,
    // 사용자 첨부만 표시명이 따로 있다. 원본명을 보내야 수신 서버 UI에 고유화 접두사가 안 뜬다.
    filename: file.displayName ?? file.filename,
    contentType: contentTypeOf(file),
    kind,
  };
}

// 수신 서버가 **파싱할** 필드라 사람이 읽는 문장이 아니라 카운트 한 줄이다(계약 문서 §2.2).
// 두 모드가 공유한다 — multipart는 logs.html을 실제로 첨부하므로 마크다운 블록이 거짓은
// 아니었지만, json 템플릿 모드는 파일을 한 장도 안 보내 같은 문장이 없는 파일을 가리켰다.
// 서술은 body의 `## 로그 요약` 섹션이 그대로 들고 있다. 카운트만 남긴 한 줄이라 번역 대상이
// 없어 본문 언어와 무관하다(축 이름은 섹션 제목이 아니라 로그 종류라 고정 영문이다).
export function logSummaryText(ctx: MarkdownContext): string | undefined {
  // 지금 이 한 줄엔 번역 문자열이 없지만 래핑은 유지한다 — 이 파일은 본문 언어 진입점이라
  // (builderLocaleWrap 게이트 대상) 라벨이 번역되는 날 감싸는 걸 잊는 자리가 되지 않게 한다.
  return withLocale(ctx.bodyLocale, () => logCountSummary(ctx));
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
    // 본문 재현 환경과 같은 출처(그 함수가 스스로 본문 언어로 감싼다).
    environment: issueEnvironmentRows(ctx),
    logSummary: logSummaryText(ctx),
    media,
    bugshot: {
      version: input.version,
      sentAt: input.sentAt,
      idempotencyKey: input.idempotencyKey,
    },
  };
}
