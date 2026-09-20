import { t } from "@/i18n";
import { dataUrlToBlob } from "@/store/blob-db";
// background와 사이드패널이 같은 판정을 써야 한다 — 양쪽이 쓰는 순수 술어는
// src/lib/ leaf로 둔다(선례: lib/jira-sprint.ts:isActiveSprint).
import { isSettableHeaderName, isSettableHeaderValue } from "@/lib/webhook-header-policy";
import {
  WebhookUrlError,
  normalizeWebhookUrl,
  type WebhookUrlVerdict,
} from "@/lib/webhook-url-policy";
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
  secret?: string;
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
function buildHeaders(auth: WebhookAuthLike, dropContentType: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of auth.headers) {
    if (!isSettableHeaderName(h.name)) continue;
    // 값 축도 같은 leaf의 술어를 쓴다 — 여기 인라인으로 두면 저장 폼이 그걸 못 보고,
    // 넣은 헤더가 저장은 되는데 전송에서 조용히 빠진다.
    if (!isSettableHeaderValue(h.value)) continue;
    // Content-Type은 forbidden이 아니라 그대로 실리는데, multipart에서 사용자가
    // application/json을 넣어두면 boundary 없는 요청이 나가고 수신 서버 파싱 실패가 무음이 된다.
    if (dropContentType && h.name.toLowerCase() === "content-type") continue;
    out[h.name] = h.value;
  }
  // 시크릿은 저장 시점에 headers로 굳히지 않고 여기서 합성한다. 그래야 (1) 폼 재편집에서
  // 값이 두 군데로 갈리지 않고 (2) redactHeaderValues가 받는 **최종** 헤더 맵에 들어가
  // 에코 서버 에러 본문에서 자동으로 가려진다. 사용자가 Authorization을 직접 정의했으면
  // 그쪽이 더 구체적인 의도라 이긴다(대소문자 무시).
  const secret = auth.secret?.trim();
  const explicit = Object.keys(out).some((k) => k.toLowerCase() === "authorization");
  if (secret && !explicit) out.Authorization = `Bearer ${secret}`;
  return out;
}

// 공용 readErrorBody를 쓰지 않는 건 그게 무제한 res.text()이기 때문이다 — 임의 서버가
// 상대라 본문을 통째로 버퍼링할 수 없다.
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

// 헤더 값 전체(`Bearer <토큰>`)만 지우면, 스킴을 떼고 토큰만 되비추는 서버(`invalid token
// <토큰>`)에서 원문이 그대로 남는다 — 한쪽 경로만 막은 마스킹이 다른 경로로 새던 형태와
// 같다(POSTMORTEM 2026-07-14). 값 전체와 함께 스킴 뒤 조각도 후보로 넣는다.
function redactionCandidates(value: string): string[] {
  const out = [value];
  const scheme = /^\S+\s+(\S.*)$/.exec(value);
  if (scheme) out.push(scheme[1]);
  return out;
}

function redactHeaderValues(body: string, headers: Record<string, string>): string {
  let out = body;
  // 긴 것부터 지운다 — 짧은 조각을 먼저 지우면 값 전체가 부분적으로 깨져 안 걸린다.
  const values = Object.values(headers)
    .flatMap(redactionCandidates)
    .filter((v) => v.length >= REDACT_MIN_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join("***");
  return out;
}

const KEY_FIELDS = ["key", "id", "number", "iid"] as const;
const URL_FIELDS = ["url", "html_url", "web_url", "link"] as const;

// 이 url은 이슈 목록 행 클릭이 chrome.tabs.create에 그대로 넘기는 값인데(IssueRow.tsx),
// 8개 플랫폼과 달리 **임의 서버가 제어한다**. 스킴을 좁히지 않으면 수신 서버가 javascript:·
// file: 주소를 계약처럼 돌려줄 수 있고, 나중에 이 값이 <a href>로 렌더되면 React는
// javascript:를 경고만 하고 그린다.
function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    const p = new URL(value).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

export function normalizeWebhookResult(body: unknown): WebhookSubmitResult {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o !== "object") return { key: undefined, url: undefined };
  const key = KEY_FIELDS.map((f) => o[f]).find((v) => v != null && v !== "");
  const url = URL_FIELDS.map((f) => o[f]).find(isOpenableUrl);
  return { key: key == null ? undefined : String(key), url };
}

// dataUrl의 base64 길이에서 바이트 수를 추정한다. Blob으로 만든 뒤 재면 캡을 넘는 입력이
// 이미 메모리에 올라간 뒤라 SW가 죽는 걸 못 막는다.
// UTF-8 바이트가 코드유닛 수 이상, 3배 이하라는 성질로 양끝을 먼저 거른다. 실제 인코딩은
// 그 사이에 걸린 입력에만 돌린다 — 매번 인코딩하면 거대한 본문이 SW 메모리를 한 번 더 친다.
function exceedsUtf8(s: string, max: number): boolean {
  if (s.length > max) return true;
  if (s.length * 3 <= max) return false;
  return new TextEncoder().encode(s).length > max;
}

// 상한 값을 3로케일 문구에 박으면 상수를 바꿀 때 6곳이 무음으로 거짓이 된다.
function capLabel(): string {
  return `${Math.round(WEBHOOK_BODY_MAX_BYTES / (1024 * 1024))}MB`;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const at = dataUrl.indexOf(",");
  if (at < 0) return dataUrl.length;
  const b64 = dataUrl.length - at - 1;
  return Math.floor((b64 * 3) / 4);
}

// 8개 플랫폼이 전부 401·403·5xx를 갈라 처방을 준다. 시크릿 오타가 이 플랫폼의 최빈 실패라
// "401 응답을 돌려줬습니다"로 끝내면 무엇을 고쳐야 하는지가 빠진다.
function statusKey(status: number): "webhook.error.401" | "webhook.error.403" | "webhook.error.5xx" | "webhook.error.status" {
  if (status === 401) return "webhook.error.401";
  if (status === 403) return "webhook.error.403";
  if (status >= 500) return "webhook.error.5xx";
  return "webhook.error.status";
}

const URL_ERROR_KEYS = {
  invalid: "webhook.error.url.invalid",
  scheme: "webhook.error.url.scheme",
  "insecure-public": "webhook.error.url.insecurePublic",
  credentials: "webhook.error.url.credentials",
} as const;

async function send(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  // 저장 시점 정책을 전송 시점에 한 번 더 건다(헤더 축과 같은 2층 방어) — 저장소가
  // 조작되거나 v12 이전 셰이프가 새면 file:·data: URL이 그대로 fetch로 간다.
  let verdict: WebhookUrlVerdict;
  try {
    verdict = normalizeWebhookUrl(url);
  } catch (e) {
    // WebhookUrlError는 PLATFORM_ERROR_CTORS 밖이라 그대로 두면 reason 원문("scheme")이
    // 번역 안 된 채 토스트가 된다. reason별로 처방이 갈리므로(스킴 교체 / https 사용 /
    // 자격증명 제거) 한 문구로 뭉치지 않는다 — "연결하지 못했습니다"는 원인을 오도한다.
    if (e instanceof WebhookUrlError) throw new WebhookError(0, t(URL_ERROR_KEYS[e.reason]));
    throw e;
  }
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
    if (!timedOut) throw new WebhookError(0, t("webhook.error.network"));
    // 초를 문구에 박지 않는다 — 제출 30초와 연결 테스트 8초가 같은 키를 쓰던 시절,
    // 8초에 죽은 테스트가 "30초 안에 응답하지 않았습니다"로 떴다. 멱등 키 안내도 재전송이
    // 있는 제출 경로에만 의미가 있어 테스트 전용 문구를 따로 둔다.
    const seconds = Math.round(timeoutMs / 1000);
    const key = timeoutMs === WEBHOOK_TEST_TIMEOUT_MS ? "webhook.error.timeoutTest" : "webhook.error.timeout";
    throw new WebhookError(0, t(key, { seconds }));
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
      t(statusKey(res.status), { status: res.status }),
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
    // 코드유닛이 아니라 실바이트로 잰다 — CJK 본문은 UTF-8에서 최대 3배라 length로 재면
    // 캡을 3배까지 넘긴 요청이 통과한다.
    if (exceedsUtf8(body, WEBHOOK_BODY_MAX_BYTES)) {
      throw new WebhookError(0, t("webhook.error.tooLarge", { limit: capLabel() }));
    }
    const headers = buildHeaders(input.auth, false);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
    await send(input.auth.url, { method: "POST", headers, body }, WEBHOOK_TIMEOUT_MS);
    // 2xx면 성공이고 응답을 읽지 않는다 — Discord처럼 204가 정상인 제3자 훅이 상대다.
    return {};
  }

  const form = new FormData();
  const payloadJson = JSON.stringify(input.payload);
  form.append("payload", payloadJson);

  // 본문이 든 payload도 캡 대상이다 — 파일만 세면 거대한 본문이 캡을 빠져나가고,
  // 파일이 0개면 검사 자체가 안 돈다.
  if (exceedsUtf8(payloadJson, WEBHOOK_BODY_MAX_BYTES)) {
    throw new WebhookError(0, t("webhook.error.tooLarge", { limit: capLabel() }));
  }
  // 코드유닛이 아니라 실바이트다 — 위 exceedsUtf8을 통과한 CJK 본문이 합산에서만
  // 최대 3배 과소 계상되면, 개별 검사를 지난 조합이 캡을 넘긴 채 나간다.
  let total = utf8Bytes(payloadJson);
  for (const file of input.files) total += estimateDataUrlBytes(file.dataUrl);
  if (total > WEBHOOK_BODY_MAX_BYTES) throw new WebhookError(0, t("webhook.error.tooLarge", { limit: capLabel() }));
  // 캡 검사를 통과한 뒤에 변환한다. 변환 직후 원본 슬롯을 비우는 건, 합본이라 순차 경로처럼
  // GC가 중간에 걷어가지 못하기 때문이다.
  for (const file of input.files) {
    form.append(file.part, dataUrlToBlob(file.dataUrl), file.filename);
    file.dataUrl = "";
  }

  // Content-Type을 세팅하지 않아야 fetch가 boundary를 붙인다.
  const res = await send(
    input.auth.url,
    { method: "POST", headers: buildHeaders(input.auth, true), body: form },
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
  const headers = buildHeaders(auth, false);
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
