import { BgError } from "@/lib/bg-client";

export type BadgeErrorKind = "deleted" | "error";

export function classifyBadgeError(err: unknown): BadgeErrorKind {
  return err instanceof BgError && (err.status === 404 || err.status === 410) ? "deleted" : "error";
}
