import { sendBg } from "@/lib/bg-client";
import type { NormalizedSubmitResult } from "@/types/platform";
import type { WebhookAuth, WebhookSubmitResult } from "@/types/webhook";
import { buildMarkdownIssueBody } from "./buildMarkdownIssueBody";
import { buildWebhookJsonBody } from "./buildWebhookJsonBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { prepareUpload, toInlineUploadFiles, type UploadFileInput } from "./prepareUpload";
import type { InlineImageInput } from "./resolveInlineImages";
import { buildWebhookPayload, contentTypeOf, logSummaryText } from "./webhookPayload";
import { renderWebhookTemplate, type WebhookTemplateVars } from "./webhookTemplate";
import { t } from "@/i18n";

export type { NormalizedSubmitResult } from "@/types/platform";

// json 템플릿 모드는 식별자를 돌려받지 못해 이슈 목록 행을 만들 근거가 없다. 그 차이를
// 주석이 아니라 판별자로 둬서, 호출부가 recorded를 보지 않고 markSubmitted에 가면
// 컴파일이 막게 한다(key·url이 그쪽 분기에 아예 없다).
export type WebhookSubmitOutcome =
  | ({ recorded: true } & NormalizedSubmitResult)
  | { recorded: false; key?: undefined; url?: undefined };

export interface WebhookSubmitInput {
  ctx: MarkdownContext;
  auth: WebhookAuth;
  images?: UploadFileInput[];
  video?: UploadFileInput;
  logs?: UploadFileInput[];
  attachments?: UploadFileInput[];
  inlineImages?: InlineImageInput[];
  // 같은 draft의 재전송은 같은 키를 쓴다 — 수신 서버가 이걸로 중복을 거른다.
  idempotencyKey: string;
}

// 네트워크를 타지 않는 가짜 업로드. 업로드와 생성이 같은 요청이라 URL을 미리 받을 수 없어,
// 본문 빌더가 요구하는 href 자리를 cid: 참조로 채운다. 그래서 someUploadMissing이 항상
// false가 되는 것이 **의도**다 — 여기엔 실패할 업로드 자체가 없다.
const cidUploadFn = async (files: { filename: string }[]) =>
  files.map((f) => ({ filename: f.filename, href: `cid:${f.filename}` }));

function templateVars(
  ctx: MarkdownContext,
  body: string,
  sections: Record<string, string>,
  files: UploadFileInput[],
): WebhookTemplateVars {
  return {
    title: ctx.title,
    body,
    url: ctx.url,
    env: {
      os: ctx.os ?? undefined,
      browser: ctx.browser ?? undefined,
      viewport: ctx.viewport ? `${ctx.viewport.width}x${ctx.viewport.height}` : undefined,
      selector: ctx.selector || undefined,
    },
    capturedAt: new Date(ctx.capturedAt).toISOString(),
    // multipart payload와 같은 출처를 쓴다. 재현 환경 행에서 라벨로 긁으면
    // 사용자가 추가한 임의 행(계정·비밀번호 메모)이 logSummary로 새어 나간다.
    logSummary: logSummaryText(ctx),
    sections,
    media: {
      count: files.length,
      // 영상에 dataUri를 주지 않는다 — base64가 실질적으로 항상 바디 캡을 넘긴다.
      items: files.map((f) => ({
        filename: f.displayName ?? f.filename,
        contentType: contentTypeOf(f),
      })),
    },
  };
}

export async function submitToWebhook(
  input: WebhookSubmitInput,
): Promise<WebhookSubmitOutcome> {
  const files = [
    ...(input.images ?? []),
    ...(input.video ? [input.video] : []),
    ...(input.logs ?? []),
    ...(input.attachments ?? []),
  ];

  if (input.auth.format === "json") {
    if (!input.auth.template) throw new Error(t("webhook.error.templateMissing"));
    const { body, sections } = buildWebhookJsonBody(input.ctx);
    const rendered = renderWebhookTemplate(
      input.auth.template,
      templateVars(input.ctx, body, sections, files),
    );
    await sendBg<WebhookSubmitResult>({
      type: "webhook.submit",
      mode: "json",
      auth: input.auth,
      body: rendered,
    });
    // 제3자 훅은 식별자를 돌려주지 않는 게 정상이라(Discord의 204) 행을 만들 근거가 없다.
    return { recorded: false };
  }

  // prepareUpload가 본문의 inline:<refId>를 cid:<파일명>으로 바꾼다. 그 파일명으로 파트를
  // 실어야 참조가 고아가 되지 않는다 — 같은 헬퍼로 이름을 뽑아 두 곳이 갈리지 않게 한다.
  const inlineFiles = toInlineUploadFiles(input.inlineImages);
  const prepared = await prepareUpload(input, cidUploadFn, { platform: "webhook" });
  const { resolvedCtx, toMedia, toAttachmentMedia, logsDropped } = prepared;

  const imageInputs = input.images ?? [];
  const { body } = buildMarkdownIssueBody(
    {
      ctx: resolvedCtx,
      images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
      video: input.video ? toMedia(input.video) : undefined,
      logs: (input.logs ?? []).map(toMedia),
      attachments: (input.attachments ?? []).map(toAttachmentMedia),
    },
    { platform: "webhook" },
  );

  const payload = buildWebhookPayload({
    ctx: resolvedCtx,
    body,
    files: {
      images: imageInputs,
      video: input.video,
      logs: input.logs ?? [],
      attachments: input.attachments ?? [],
    },
    inlineFiles,
    idempotencyKey: input.idempotencyKey,
    sentAt: Date.now(),
    version: chrome.runtime.getManifest().version,
  });

  // 승격 가드(requireMediaUpload)가 필요 없다. 두 모드 모두 **단일 POST(atomic)**라
  // "업로드는 성공했는데 생성이 실패"가 구조적으로 불가능하다 — POSTMORTEM 2026-06-30
  // 분류의 (d) atomic 군(Jira와 같다). 호출부는 이 함수가 resolve한 뒤에만 markSubmitted로
  // 원본을 파괴하고, 실패는 전부 throw로 나가 draft·blob이 보존된다.
  const result = await sendBg<WebhookSubmitResult>({
    type: "webhook.submit",
    mode: "multipart",
    auth: input.auth,
    payload,
    files: [...files, ...inlineFiles].map((f) => ({
      part: f.filename,
      filename: f.displayName ?? f.filename,
      dataUrl: f.dataUrl,
    })),
  });

  // background가 계약 위반이면 이미 throw했다. 그래도 캐스트 대신 확인하는 건, 그 가드가
  // 사라졌을 때 여기서 key·url 없는 행이 조용히 만들어지지 않게 하려는 것이다.
  if (!result.key || !result.url) throw new Error(t("webhook.error.contract"));
  return { recorded: true, key: result.key, url: result.url, logsDropped };
}
