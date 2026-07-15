import { originOf } from "./session-keys";

export function shouldClearLogs(
  previousUrl: string,
  nextUrl: string,
  transitionType: string,
): boolean {
  if (transitionType === "reload") return true;

  const prevOrigin = originOf(previousUrl);
  if (prevOrigin == null) return true;

  const nextOrigin = originOf(nextUrl);
  if (nextOrigin == null) return true;

  return prevOrigin !== nextOrigin;
}
