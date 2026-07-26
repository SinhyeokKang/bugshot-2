// DebugTab의 잠금·폴링 판정. 풀 렌더가 IssueTab(→ tiptap·sonner)을 끌어오므로 순수 술어로 뺀다.

export function areLogTabsLocked(input: { phase: string; unsupported: boolean }): boolean {
  return input.phase === "recording" || input.unsupported;
}

export function shouldSyncRecorders(input: {
  activeMainTab: string;
  sub: string;
  unsupported: boolean;
}): boolean {
  if (input.activeMainTab !== "debug") return false;
  if (input.sub === "console" || input.sub === "network") return false;
  return !input.unsupported;
}
