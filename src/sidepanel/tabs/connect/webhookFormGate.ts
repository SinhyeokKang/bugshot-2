import { isSettableHeaderName } from "@/lib/webhook-header-policy";
import {
  normalizeWebhookUrl,
  WebhookUrlError,
  type WebhookUrlRejection,
} from "@/lib/webhook-url-policy";
import { parseWebhookTemplate, type TemplateIssue } from "@/sidepanel/lib/webhookTemplate";
import type { WebhookAuth, WebhookFormat, WebhookHeader } from "@/types/webhook";

export type WebhookFormIssue =
  | { kind: "url"; reason: WebhookUrlRejection }
  | { kind: "header-name"; name: string }
  | { kind: "header-duplicate"; name: string }
  | { kind: "template-empty" }
  | { kind: "template"; issue: TemplateIssue };

export interface WebhookFormDraft {
  url: string;
  secret: string;
  headers: WebhookHeader[];
  format: WebhookFormat;
  template: string;
}

export type WebhookFormVerdict =
  | { ok: true; auth: WebhookAuth; plaintext: boolean }
  | { ok: false; issues: WebhookFormIssue[] };

// 저장 시점 게이트. 나가는 요청의 방어선은 background의 `send()`이고(POSTMORTEM 2026-08-11
// "자격증명 가드가 입력 폼에만 있어서"), 이건 그 거부를 제출 시점이 아니라 입력 시점에
// 보여주려는 안내 층이다 — 같은 판정 함수를 부르므로 둘이 갈리지 않는다.
export function validateWebhookForm(draft: WebhookFormDraft): WebhookFormVerdict {
  const issues: WebhookFormIssue[] = [];

  let url = "";
  let plaintext = false;
  try {
    const verdict = normalizeWebhookUrl(draft.url);
    url = verdict.url;
    plaintext = verdict.plaintext;
  } catch (e) {
    issues.push({ kind: "url", reason: e instanceof WebhookUrlError ? e.reason : "invalid" });
  }

  const headers: WebhookHeader[] = [];
  const seen = new Set<string>();
  for (const h of draft.headers) {
    const name = h.name.trim();
    const value = h.value.trim();
    // 마지막 빈 행은 UI가 만든 것이지 사용자가 쓴 헤더가 아니다. 값만 있고 이름이 비면
    // 조용히 버리지 않는다 — 나갈 줄 알았던 헤더가 사라지는 쪽이 더 나쁘다.
    if (!name && !value) continue;
    if (!isSettableHeaderName(name)) {
      issues.push({ kind: "header-name", name });
      continue;
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      issues.push({ kind: "header-duplicate", name: lower });
      continue;
    }
    seen.add(lower);
    headers.push({ name, value });
  }

  const template = draft.template.trim();
  if (draft.format === "json") {
    if (!template) {
      issues.push({ kind: "template-empty" });
    } else {
      const parsed = parseWebhookTemplate(template);
      for (const issue of parsed.issues) issues.push({ kind: "template", issue });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    plaintext,
    auth: {
      url,
      // 시크릿은 headers로 굳히지 않는다 — 전송 시점에 buildHeaders가 합성한다(Task 5-b).
      secret: draft.secret.trim() || undefined,
      headers,
      format: draft.format,
      // multipart일 때도 보존한다. format을 오가며 편집할 때 템플릿이 사라지면 다시 써야 한다.
      template: template || undefined,
    },
  };
}

// 고급을 열어둔 채 여는 기준. 시크릿은 기본 화면 값이라 여기 들어가지 않는다.
export function hasAdvancedValues(auth: WebhookAuth | undefined): boolean {
  if (!auth) return false;
  return auth.headers.length > 0 || auth.format === "json";
}
