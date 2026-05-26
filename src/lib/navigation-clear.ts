export function shouldClearLogs(
  previousUrl: string,
  nextUrl: string,
  transitionType: string,
): boolean {
  if (transitionType === "reload") return true;

  let prevOrigin: string;
  try {
    prevOrigin = new URL(previousUrl).origin;
  } catch {
    return true;
  }

  let nextOrigin: string;
  try {
    nextOrigin = new URL(nextUrl).origin;
  } catch {
    return true;
  }

  return prevOrigin !== nextOrigin;
}
