// captureVisibleTab/tabCapture가 activeTab grant 만료로 거부될 때의 에러 메시지를 식별한다.
export function isActiveTabPermissionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("activetab") ||
    msg.includes("all_urls") ||
    msg.includes("extension has not been invoked")
  );
}
