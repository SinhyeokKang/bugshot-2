import { BgError } from "@/types/messages";

export type BadgeErrorKind = "deleted" | "error";

export function classifyBadgeError(err: unknown): BadgeErrorKind {
  return err instanceof BgError && err.status === 404 ? "deleted" : "error";
}
