import {
  deleteActionLog,
  deleteAttachmentBlobs,
  deleteConsoleLog,
  deleteNetworkLog,
  deleteVideoBlob,
  getActionLogKeys,
  getAttachmentBlobKeys,
  getConsoleLogKeys,
  getNetworkLogKeys,
  getVideoBlobKeys,
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

// 첨부 blob 키는 `pending:${tabId}:${uuid}` 형식이라 로그(`pending:${tabId}`)와 파싱이 다르다.
// tabId는 첫 세그먼트. 고아 tab별 owner 프리픽스(`pending:${tabId}`)를 중복 없이 반환 →
// deleteAttachmentBlobs(owner)로 일괄 삭제.
export function findOrphanPendingAttachmentOwners(
  keys: string[],
  activeTabIds: Set<number>,
): string[] {
  const owners = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(PENDING_PREFIX)) continue;
    const tabIdStr = key.slice(PENDING_PREFIX.length).split(":")[0];
    const tabId = Number(tabIdStr);
    if (tabIdStr === "" || !Number.isInteger(tabId)) {
      owners.add(`${PENDING_PREFIX}${tabIdStr}`);
      continue;
    }
    if (!activeTabIds.has(tabId)) owners.add(`${PENDING_PREFIX}${tabId}`);
  }
  return [...owners];
}

export async function getActiveTabIds(): Promise<Set<number>> {
  const tabs = await chrome.tabs.query({});
  const ids = new Set<number>();
  for (const t of tabs) if (t.id != null) ids.add(t.id);
  return ids;
}

export async function pruneOrphanPendingLogs(): Promise<void> {
  const activeTabIds = await getActiveTabIds();
  const [networkKeys, consoleKeys, actionKeys, videoKeys, attachmentKeys] = await Promise.all([
    getNetworkLogKeys(),
    getConsoleLogKeys(),
    getActionLogKeys(),
    getVideoBlobKeys(),
    getAttachmentBlobKeys(),
  ]);
  const networkOrphans = findOrphanPendingKeys(networkKeys, activeTabIds);
  const consoleOrphans = findOrphanPendingKeys(consoleKeys, activeTabIds);
  const actionOrphans = findOrphanPendingKeys(actionKeys, activeTabIds);
  const videoOrphans = findOrphanPendingKeys(videoKeys, activeTabIds);
  const attachmentOrphanOwners = findOrphanPendingAttachmentOwners(attachmentKeys, activeTabIds);
  await Promise.all([
    ...networkOrphans.map((k) => deleteNetworkLog(k).catch(() => {})),
    ...consoleOrphans.map((k) => deleteConsoleLog(k).catch(() => {})),
    ...actionOrphans.map((k) => deleteActionLog(k).catch(() => {})),
    ...videoOrphans.map((k) => deleteVideoBlob(k).catch(() => {})),
    ...attachmentOrphanOwners.map((o) => deleteAttachmentBlobs(o).catch(() => {})),
  ]);
}

const SESSION_FLAG = "pendingPrunedAt";

// SW가 idle suspend→wake 사이클을 반복하지만, 같은 chrome.storage.session 인스턴스 동안엔
// 1회만 돌도록 가드. 브라우저 종료까지가 세션 경계.
export async function pruneOrphanPendingLogsOncePerSession(): Promise<void> {
  try {
    const data = await chrome.storage.session.get(SESSION_FLAG);
    if (data[SESSION_FLAG]) return;
    await pruneOrphanPendingLogs();
    await chrome.storage.session.set({ [SESSION_FLAG]: Date.now() });
  } catch {
    return;
  }
}
