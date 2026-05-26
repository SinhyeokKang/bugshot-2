export const PICKER_PORT_NAME = "bugshot-picker";
export const PANEL_PORT_PREFIX = "bugshot-panel:";

export const EDITOR_SESSION_PREFIX = "editor:";

export function sessionKey(tabId: number): string {
  return `${EDITOR_SESSION_PREFIX}${tabId}`;
}

export function pageKeyOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}
