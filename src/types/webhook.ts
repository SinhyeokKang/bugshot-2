import type { PlatformAccountBase } from "./platform";

export type WebhookFormat = "multipart" | "json";

export interface WebhookHeader {
  name: string;
  value: string;
}

export interface WebhookAuth {
  // normalizeWebhookUrl를 통과한 값만 저장된다.
  url: string;
  // 기본 폼의 두 번째 칸. 전송 시점에 Authorization 헤더로 합성한다 — headers로 굳히지
  // 않는 건 폼 재편집에서 같은 값이 두 군데로 갈리기 때문이다.
  secret?: string;
  headers: WebhookHeader[];
  format: WebhookFormat;
  // format === "json"일 때만 의미가 있다.
  template?: string;
}

export interface WebhookAccount extends PlatformAccountBase<"webhook"> {
  auth: WebhookAuth;
}

export type WebhookMediaKind = "image" | "video" | "logs" | "attachment" | "inline";

export interface WebhookMediaEntry {
  // multipart 파트 이름 == 본문의 cid: 참조 대상. 둘이 갈리면 수신 서버가 본문의
  // 참조를 자기 스토리지 URL로 못 바꾼다.
  part: string;
  // 사용자에게 보이는 이름. 첨부는 원본명이라 part와 다를 수 있다.
  filename: string;
  contentType: string;
  kind: WebhookMediaKind;
}

export interface WebhookSubmitPayload {
  title: string;
  // 마크다운. 미디어는 cid:<part>로 참조한다.
  body: string;
  environment: { label: string; value: string }[];
  logSummary?: string;
  media: WebhookMediaEntry[];
  // idempotencyKey: 타임아웃·SW 종료 후 재시도가 중복 리포트를 만들지 않게 하는 계약.
  // 같은 draft의 재전송은 같은 키를 쓴다 — 수신 서버가 이걸로 dedup한다.
  bugshot: { version: string; sentAt: number; idempotencyKey: string };
}

export interface WebhookSubmitResult {
  key?: string;
  url?: string;
}
