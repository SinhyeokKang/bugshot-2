export function networkLogPath(url: string): string {
  if (!url) return url;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
