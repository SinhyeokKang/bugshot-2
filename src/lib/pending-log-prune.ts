import {
  deleteActionLog,
  deleteConsoleLog,
  deleteNetworkLog,
  getActionLogKeys,
  getConsoleLogKeys,
  getNetworkLogKeys,
} from "@/store/blob-db";

const PENDING_PREFIX = "pending:";

export function findOrphanPendingKeys(
  keys: string[],
  activeTabIds: Set<number>,
): string[] {
  const orphans: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(PENDING_PREFIX)) continue;
    const raw = key.slice(PENDING_PREFIX.length);
    if (raw === "") {
      orphans.push(key);
      continue;
    }
    const tabId = Number(raw);
    if (!Number.isInteger(tabId)) {
      orphans.push(key);
      continue;
    }
    if (!activeTabIds.has(tabId)) orphans.push(key);
  }
  return orphans;
}

async function getActiveTabIds(): Promise<Set<number>> {
  try {
    const tabs = await chrome.tabs.query({});
    const ids = new Set<number>();
    for (const t of tabs) if (t.id != null) ids.add(t.id);
    return ids;
  } catch {
    return new Set();
  }
}

export async function pruneOrphanPendingLogs(): Promise<void> {
  const activeTabIds = await getActiveTabIds();
  const [networkKeys, consoleKeys, actionKeys] = await Promise.all([
    getNetworkLogKeys(),
    getConsoleLogKeys(),
    getActionLogKeys(),
  ]);
  const networkOrphans = findOrphanPendingKeys(networkKeys, activeTabIds);
  const consoleOrphans = findOrphanPendingKeys(consoleKeys, activeTabIds);
  const actionOrphans = findOrphanPendingKeys(actionKeys, activeTabIds);
  await Promise.all([
    ...networkOrphans.map((k) => deleteNetworkLog(k).catch(() => {})),
    ...consoleOrphans.map((k) => deleteConsoleLog(k).catch(() => {})),
    ...actionOrphans.map((k) => deleteActionLog(k).catch(() => {})),
  ]);
}

const SESSION_FLAG = "pendingPrunedAt";

// SW가 idle suspend→wake 사이클을 반복하지만, 같은 chrome.storage.session 인스턴스 동안엔
// 1회만 돌도록 가드. 브라우저 종료까지가 세션 경계.
export async function pruneOrphanPendingLogsOncePerSession(): Promise<void> {
  try {
    const data = await chrome.storage.session.get(SESSION_FLAG);
    if (data[SESSION_FLAG]) return;
    await chrome.storage.session.set({ [SESSION_FLAG]: Date.now() });
  } catch {
    return;
  }
  await pruneOrphanPendingLogs();
}
