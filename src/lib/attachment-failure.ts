import type { AttachmentFailureCode, AttachmentResult, AttachmentRetryReason, AttachmentStage } from "@/types/attachment";

// Slack answers HTTP 200 with an error code; across the message boundary the code rides in the body.
const SLACK_AUTH_CODES = ["invalid_auth", "not_authed", "token_revoked", "account_inactive"];
const SLACK_PERMISSION_CODES = ["not_in_channel", "missing_scope", "no_permission", "restricted_action"];
const SLACK_MISSING_CODES = ["channel_not_found"];
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  const body = "body" in error && error.body && typeof error.body === "object" ? error.body as Record<string, unknown> : undefined;
  return typeof body?.code === "string" ? body.code : undefined;
}

export function attachmentFailureCode(error: { httpStatus?: number; message?: string }): AttachmentFailureCode {
  switch (error.httpStatus) {
    case 401: return "authentication";
    case 403: return "permission";
    case 413: return "size-limit";
    case 429: return "rate-limit";
    case 408: case 504: return "timeout";
    default: return "unknown";
  }
}

export function safeAttachmentFailure(error: unknown, stage: AttachmentStage = "upload"): NonNullable<AttachmentResult["failure"]> {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  const providerCode = errorCode(error);
  const slackCode = httpStatus === 200 && providerCode
    ? SLACK_AUTH_CODES.includes(providerCode) ? "authentication"
      : [...SLACK_PERMISSION_CODES, ...SLACK_MISSING_CODES].includes(providerCode) ? "permission"
      : providerCode === "ratelimited" ? "rate-limit" : undefined
    : undefined;
  const code = slackCode ?? (httpStatus !== undefined ? attachmentFailureCode({ httpStatus })
    : name === "AbortError" || name === "TimeoutError" ? "timeout" : name === "TypeError" ? "network" : "unknown");
  return { stage, code, ...(httpStatus !== undefined ? { httpStatus } : {}) };
}

// Why a retry against an existing remote issue cannot proceed; raw text is never kept.
export function retryFailureReason(error: unknown): Extract<AttachmentRetryReason, "authentication" | "permission" | "remote-missing" | "ambiguous"> {
  const value = error && typeof error === "object" ? error as { status?: unknown; body?: unknown } : {};
  const body = value.body && typeof value.body === "object" ? value.body as Record<string, unknown> : {};
  const code = errorCode(error) ?? "";
  if (body.oauthRefreshFailed === true || value.status === 401 || SLACK_AUTH_CODES.includes(code)) return "authentication";
  if (value.status === 403 || SLACK_PERMISSION_CODES.includes(code)) return "permission";
  if (value.status === 404 || value.status === 410 || SLACK_MISSING_CODES.includes(code)) return "remote-missing";
  return "ambiguous";
}
