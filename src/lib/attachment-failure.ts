import type { AttachmentFailureCode, AttachmentResult, AttachmentStage } from "@/types/attachment";

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
  const providerCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const slackCode = httpStatus === 200 && typeof providerCode === "string"
    ? ["invalid_auth", "token_revoked", "account_inactive"].includes(providerCode) ? "authentication"
      : ["not_in_channel", "channel_not_found", "missing_scope", "no_permission"].includes(providerCode) ? "permission"
      : providerCode === "ratelimited" ? "rate-limit" : undefined
    : undefined;
  const code = slackCode ?? (httpStatus !== undefined ? attachmentFailureCode({ httpStatus })
    : name === "AbortError" || name === "TimeoutError" ? "timeout" : name === "TypeError" ? "network" : "unknown");
  return { stage, code, ...(httpStatus !== undefined ? { httpStatus } : {}) };
}
