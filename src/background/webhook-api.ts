import { t } from "@/i18n";
import { dataUrlToBlob } from "@/store/blob-db";
// background와 사이드패널이 같은 판정을 써야 한다 — 양쪽이 쓰는 순수 술어는
// src/lib/ leaf로 둔다(선례: lib/jira-sprint.ts:isActiveSprint).
import { isSettableHeaderName } from "@/lib/webhook-header-policy";
import { normalizeWebhookUrl } from "@/lib/webhook-url-policy";
import type { WebhookHeader, WebhookSubmitPayload, WebhookSubmitResult } from "@/types/webhook";

export class WebhookError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

export const WEBHOOK_TIMEOUT_MS = 30_000;
export const WEBHOOK_TEST_TIMEOUT_MS = 8_000;
export const WEBHOOK_BODY_MAX_BYTES = 25 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 8 * 1024;

interface WebhookAuthLike {
  url: string;
  headers: WebhookHeader[];
}

// ⚠ submitWebhook은 이 배열을 **소비한다** — 변환 직후 dataUrl 슬롯을 비운다.
// multipart는 파일 전부를 한 요청에 합치므로, 순차 업로드 경로와 달리 GC가 중간에
// 원본을 걷어갈 틈이 없다. 재사용하려면 호출부가 사본을 넘겨야 한다.
export interface WebhookFilePart {
  part: string;
  filename: string;
  dataUrl: string;
}

export type SubmitWebhookInput =
  | {
      mode: "multipart";
      auth: WebhookAuthLike;
      payload: WebhookSubmitPayload;
      files: WebhookFilePart[];
    }
  | { mode: "json"; auth: WebhookAuthLike; body: unknown };

// 사용자 헤더는 여기를 통과한 것만 나간다. 통과 못 한 이름은 fetch가 조용히 드롭하므로
// 저장 시점(연결 폼)과 전송 시점 둘 다에서 같은 술어로 거른다.
function buildHeaders(headers: WebhookHeader[], dropContentType: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    if (!isSettableHeaderName(h.name)) continue;
    // 값에 CR/LF·제어문자가 있으면 Headers 생성자가 동기 TypeError를 던져 요청이 통째로
    // 죽고 "network"로 보고된다. 이름 축만 막아두면 같은 실패 모드가 값 쪽에 남는다.
    if (!/^[\t\x20-\x7e\x80-\xff]*$/.test(h.value)) continue;
    // Content-Type은 forbidden이 아니라 그대로 실리는데, multipart에서 사용자가
    // application/json을 넣어두면 boundary 없는 요청이 나가고 수신 서버 파싱 실패가 무음이 된다.
    if (dropContentType && h.name.toLowerCase() === "content-type") continue;
    out[h.name] = h.value;
  }
  return out;
}

// readErrorBody(@/background/lib/readErrorBody)는 무제한 res.text()라 임의 서버 상대로 못 쓴다.
export async function readCappedErrorBody(res: Response, maxBytes: number): Promise<string | null> {
  try {
    if (!res.body) {
      const text = await res.text();
      return text.slice(0, maxBytes);
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(value);
      if (total > maxBytes) {
        await reader.cancel();
        break;
      }
    }
    const merged = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      merged.set(c, at);
      at += c.byteLength;
    }
    return new TextDecoder().decode(merged).slice(0, maxBytes);
  } catch {
    return null;
  }
}

// 짧은 값은 되레 오탐(“1”·“on”)이 많아 건드리지 않는다. 시크릿은 길다.
const REDACT_MIN_LENGTH = 8;

function redactHeaderValues(body: string, headers: Record<string, string>): string {
  let out = body;
  for (const value of Object.values(headers)) {
    if (value.length < REDACT_MIN_LENGTH) continue;
    out = out.split(value).join("***");
  }
  return out;
}

const KEY_FIELDS = ["key", "id", "number", "iid"] as const;
const URL_FIELDS = ["url", "html_url", "web_url", "link"] as const;

export function normalizeWebhookResult(body: unknown): WebhookSubmitResult {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o !== "object") return { key: undefined, url: undefined };
  const key = KEY_FIELDS.map((f) => o[f]).find((v) => v != null && v !== "");
  const url = URL_FIELDS.map((f) => o[f]).find((v) => typeof v === "string" && v !== "");
  return { key: key == null ? undefined : String(key), url: url as string | undefined };
}

// dataUrl의 base64 길이에서 바이트 수를 추정한다. Blob으로 만든 뒤 재면 캡을 넘는 입력이
// 이미 메모리에 올라간 뒤라 SW가 죽는 걸 못 막는다.
function estimateDataUrlBytes(dataUrl: string): number {
  const at = dataUrl.indexOf(",");
  if (at < 0) return dataUrl.length;
  const b64 = dataUrl.length - at - 1;
  return Math.floor((b64 * 3) / 4);
}

async function send(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  // 저장 시점 정책을 전송 시점에 한 번 더 건다(헤더 축과 같은 2층 방어) — 저장소가
  // 조작되거나 v12 이전 셰이프가 새면 file:·data: URL이 그대로 fetch로 간다.
  const verdict = normalizeWebhookUrl(url);
  let res: Response;
  try {
    res = await fetch(verdict.url, {
      ...init,
      // 302를 따라가면 사용자 Authorization이 그 호스트로 샌다.
      redirect: "manual",
      // 임의 서버에 브라우저 쿠키를 붙이지 않는다.
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // 에러 메시지에 요청 헤더를 절대 싣지 않는다(불변식).
    // 8어댑터와 같이 background에서 문구를 만든다 — 이 message가 그대로 토스트다.
    const timedOut = (e as Error).name === "TimeoutError";
    throw new WebhookError(0, t(timedOut ? "webhook.error.timeout" : "webhook.error.network"));
  }
  // redirect:"manual"이면 fetch가 따라가지 않으므로 redirected는 늘 false다. opaque 응답은
  // status 0으로 오므로 선례(ai-provider.ts)와 같이 두 항을 본다.
  if (res.type === "opaqueredirect" || res.status === 0) {
    throw new WebhookError(0, t("webhook.error.redirect"));
  }
  if (!res.ok) {
    const body = await readCappedErrorBody(res, ERROR_BODY_MAX_BYTES);
    throw new WebhookError(
      res.status,
      t("webhook.error.status", { status: res.status }),
      // 에코 서버는 받은 헤더를 응답에 되비춘다. 그 본문이 토스트로 올라오면 사용자
      // 토큰이 화면·스크린샷에 뜬다 — 새 유출 경계는 아니지만(그 서버는 이미 받았다)
      // "에러에 헤더를 싣지 않는다"는 불변식이 간접 경로로 깨지는 자리다.
      body == null ? body : redactHeaderValues(body, init.headers as Record<string, string>),
    );
  }
  return res;
}

export async function submitWebhook(input: SubmitWebhookInput): Promise<WebhookSubmitResult> {
  if (input.mode === "json") {
    const body = JSON.stringify(input.body);
    if (body.length > WEBHOOK_BODY_MAX_BYTES) throw new WebhookError(0, t("webhook.error.tooLarge"));
    const headers = buildHeaders(input.auth.headers, false);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
    await send(input.auth.url, { method: "POST", headers, body }, WEBHOOK_TIMEOUT_MS);
    // 2xx면 성공이고 응답을 읽지 않는다 — Discord처럼 204가 정상인 제3자 훅이 상대다.
    return {};
  }

  const form = new FormData();
  form.append("payload", JSON.stringify(input.payload));

  let total = 0;
  for (const file of input.files) {
    total += estimateDataUrlBytes(file.dataUrl);
    if (total > WEBHOOK_BODY_MAX_BYTES) throw new WebhookError(0, t("webhook.error.tooLarge"));
  }
  // 캡 검사를 통과한 뒤에 변환한다. 변환 직후 원본 슬롯을 비우는 건, 합본이라 순차 경로처럼
  // GC가 중간에 걷어가지 못하기 때문이다.
  for (const file of input.files) {
    form.append(file.part, dataUrlToBlob(file.dataUrl), file.filename);
    (file as { dataUrl: string }).dataUrl = "";
  }

  // Content-Type을 세팅하지 않아야 fetch가 boundary를 붙인다.
  const res = await send(
    input.auth.url,
    { method: "POST", headers: buildHeaders(input.auth.headers, true), body: form },
    WEBHOOK_TIMEOUT_MS,
  );

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const result = normalizeWebhookResult(parsed);
  // multipart는 {key,url}이 계약이다. 없으면 이슈 목록 행을 만들 근거가 없고, 반쪽 성공
  // 상태를 만들지 않으려고 제출 자체를 실패로 처리한다(draft·blob 보존).
  if (!result.key || !result.url) throw new WebhookError(res.status, t("webhook.error.contract"));
  return result;
}

export async function testWebhook(auth: WebhookAuthLike): Promise<void> {
  const headers = buildHeaders(auth.headers, false);
  headers["X-BugShot-Test"] = "1";
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  await send(
    auth.url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ bugshot: { test: true, sentAt: Date.now() } }),
    },
    WEBHOOK_TEST_TIMEOUT_MS,
  );
}
