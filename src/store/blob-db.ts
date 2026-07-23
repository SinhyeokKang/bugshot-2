import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { EDITOR_SESSION_PREFIX } from "@/lib/session-keys";

const DB_NAME = "bugshot-video";
const DB_VERSION = 8;
const STORE_VIDEO = "blobs";
const STORE_IMAGES = "images";
const STORE_NETWORK = "networkLogs";
const STORE_CONSOLE = "consoleLogs";
const STORE_ACTION = "actionLogs";
const STORE_INLINE_IMAGES = "inlineImages";
const STORE_INLINE_ORIGINS = "inlineImageOrigins";
const STORE_ATTACHMENTS = "attachments";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_VIDEO)) {
        db.createObjectStore(STORE_VIDEO);
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES);
      }
      if (!db.objectStoreNames.contains(STORE_NETWORK)) {
        db.createObjectStore(STORE_NETWORK);
      }
      if (!db.objectStoreNames.contains(STORE_CONSOLE)) {
        db.createObjectStore(STORE_CONSOLE);
      }
      if (!db.objectStoreNames.contains(STORE_ACTION)) {
        db.createObjectStore(STORE_ACTION);
      }
      if (!db.objectStoreNames.contains(STORE_INLINE_IMAGES)) {
        db.createObjectStore(STORE_INLINE_IMAGES);
      }
      if (!db.objectStoreNames.contains(STORE_INLINE_ORIGINS)) {
        db.createObjectStore(STORE_INLINE_ORIGINS);
      }
      if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
        db.createObjectStore(STORE_ATTACHMENTS);
      }
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error("DB upgrade blocked by open connection"));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Video blob API ---

export async function saveVideoBlob(issueId: string, blob: Blob): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_VIDEO, "readwrite");
    tx.objectStore(STORE_VIDEO).put(blob, issueId);
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveVideoBlob failed:", e);
    return false;
  }
}

export async function getVideoBlob(issueId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_VIDEO, "readonly");
    const req = tx.objectStore(STORE_VIDEO).get(issueId);
    await txComplete(tx);
    return req.result instanceof Blob ? req.result : null;
  } catch (e) {
    console.warn("[blob-db] getVideoBlob failed:", e);
    return null;
  }
}

export async function deleteVideoBlob(issueId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_VIDEO, "readwrite");
    tx.objectStore(STORE_VIDEO).delete(issueId);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteVideoBlob failed:", e);
  }
}

export async function getVideoBlobKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_VIDEO, "readonly");
    const req = tx.objectStore(STORE_VIDEO).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getVideoBlobKeys failed:", e);
    return [];
  }
}

export async function clearVideoBlobs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_VIDEO, "readwrite");
    tx.objectStore(STORE_VIDEO).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearVideoBlobs failed:", e);
  }
}

// --- Image blob API ---

// before/after = 현재(마지막) element. b${n}-before/after = 복수 element 버퍼의 n번째.
export type ImageSlot =
  | "before"
  | "after"
  | `b${number}-before`
  | `b${number}-after`;

function imageKey(issueId: string, slot: ImageSlot): string {
  return `${issueId}:${slot}`;
}

async function saveImageBlobRaw(
  issueId: string,
  slot: ImageSlot,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_IMAGES, "readwrite");
  tx.objectStore(STORE_IMAGES).put(blob, imageKey(issueId, slot));
  await txComplete(tx);
}

export async function saveImageBlob(
  issueId: string,
  slot: ImageSlot,
  blob: Blob,
): Promise<boolean> {
  try {
    await saveImageBlobRaw(issueId, slot, blob);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveImageBlob failed:", e);
    return false;
  }
}

export { saveImageBlobRaw };

export async function getImageBlob(
  issueId: string,
  slot: ImageSlot,
): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const req = tx.objectStore(STORE_IMAGES).get(imageKey(issueId, slot));
    await txComplete(tx);
    return req.result instanceof Blob ? req.result : null;
  } catch (e) {
    console.warn("[blob-db] getImageBlob failed:", e);
    return null;
  }
}

export async function deleteImageBlobs(issueId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    const store = tx.objectStore(STORE_IMAGES);
    // before/after + 임의 개수의 b${n}-* 버퍼 슬롯을 모두 정리(접두사 매치) — 고아 방지.
    const prefix = `${issueId}:`;
    await new Promise<void>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of req.result as string[]) {
          if (k.startsWith(prefix)) store.delete(k);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteImageBlobs failed:", e);
  }
}

export async function getImageBlobKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const req = tx.objectStore(STORE_IMAGES).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getImageBlobKeys failed:", e);
    return [];
  }
}

export async function clearImageBlobs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    tx.objectStore(STORE_IMAGES).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearImageBlobs failed:", e);
  }
}

// --- Network log API ---

export async function saveNetworkLog(key: string, log: NetworkLog): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NETWORK, "readwrite");
    tx.objectStore(STORE_NETWORK).put(log, key);
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveNetworkLog failed:", e);
    return false;
  }
}

export async function getNetworkLog(key: string): Promise<NetworkLog | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NETWORK, "readonly");
    const req = tx.objectStore(STORE_NETWORK).get(key);
    await txComplete(tx);
    return (req.result as NetworkLog) ?? null;
  } catch (e) {
    console.warn("[blob-db] getNetworkLog failed:", e);
    return null;
  }
}

export async function deleteNetworkLog(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NETWORK, "readwrite");
    tx.objectStore(STORE_NETWORK).delete(key);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteNetworkLog failed:", e);
  }
}

export async function getNetworkLogKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NETWORK, "readonly");
    const req = tx.objectStore(STORE_NETWORK).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getNetworkLogKeys failed:", e);
    return [];
  }
}

export async function clearNetworkLogs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NETWORK, "readwrite");
    tx.objectStore(STORE_NETWORK).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearNetworkLogs failed:", e);
  }
}

// --- Console log API ---

export async function saveConsoleLog(key: string, log: ConsoleLog): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_CONSOLE, "readwrite");
    tx.objectStore(STORE_CONSOLE).put(log, key);
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveConsoleLog failed:", e);
    return false;
  }
}

export async function getConsoleLog(key: string): Promise<ConsoleLog | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_CONSOLE, "readonly");
    const req = tx.objectStore(STORE_CONSOLE).get(key);
    await txComplete(tx);
    return (req.result as ConsoleLog) ?? null;
  } catch (e) {
    console.warn("[blob-db] getConsoleLog failed:", e);
    return null;
  }
}

export async function deleteConsoleLog(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_CONSOLE, "readwrite");
    tx.objectStore(STORE_CONSOLE).delete(key);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteConsoleLog failed:", e);
  }
}

export async function getConsoleLogKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_CONSOLE, "readonly");
    const req = tx.objectStore(STORE_CONSOLE).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getConsoleLogKeys failed:", e);
    return [];
  }
}

export async function clearConsoleLogs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_CONSOLE, "readwrite");
    tx.objectStore(STORE_CONSOLE).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearConsoleLogs failed:", e);
  }
}

// --- Action log API ---

export async function saveActionLog(key: string, log: ActionLog): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ACTION, "readwrite");
    tx.objectStore(STORE_ACTION).put(log, key);
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveActionLog failed:", e);
    return false;
  }
}

export async function getActionLog(key: string): Promise<ActionLog | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ACTION, "readonly");
    const req = tx.objectStore(STORE_ACTION).get(key);
    await txComplete(tx);
    return (req.result as ActionLog) ?? null;
  } catch (e) {
    console.warn("[blob-db] getActionLog failed:", e);
    return null;
  }
}

export async function deleteActionLog(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ACTION, "readwrite");
    tx.objectStore(STORE_ACTION).delete(key);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteActionLog failed:", e);
  }
}

export async function getActionLogKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ACTION, "readonly");
    const req = tx.objectStore(STORE_ACTION).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getActionLogKeys failed:", e);
    return [];
  }
}

export async function clearActionLogs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ACTION, "readwrite");
    tx.objectStore(STORE_ACTION).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearActionLogs failed:", e);
  }
}

// --- Inline image API ---

export async function saveInlineImage(refId: string, blob: Blob): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_IMAGES, "readwrite");
    tx.objectStore(STORE_INLINE_IMAGES).put(blob, refId);
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveInlineImage failed:", e);
    return false;
  }
}

export async function getInlineImage(refId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_IMAGES, "readonly");
    const req = tx.objectStore(STORE_INLINE_IMAGES).get(refId);
    await txComplete(tx);
    return req.result instanceof Blob ? req.result : null;
  } catch (e) {
    console.warn("[blob-db] getInlineImage failed:", e);
    return null;
  }
}

export async function deleteInlineImages(refIds: string[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_IMAGES, "readwrite");
    const store = tx.objectStore(STORE_INLINE_IMAGES);
    for (const id of refIds) store.delete(id);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteInlineImages failed:", e);
  }
}

export async function getInlineImageKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_IMAGES, "readonly");
    const req = tx.objectStore(STORE_INLINE_IMAGES).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getInlineImageKeys failed:", e);
    return [];
  }
}

export async function clearInlineImages(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_IMAGES, "readwrite");
    tx.objectStore(STORE_INLINE_IMAGES).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearInlineImages failed:", e);
  }
}

// --- Inline image origin backup API ---
// 어노테이션 직전 원본 백업. inlineImages와 refId 공간을 공유하되 별도 store라 prune 대상 밖
// (markdown에 안 나타나므로). 초기화(reset)로 원본 복원 후 삭제한다. clearInlineOrigins는
// 두지 않는다 — 대칭인 clearInlineImages가 이미 호출처 0(dead)이라 대칭 추가도 dead code.

export async function saveInlineOrigin(refId: string, blob: Blob): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_ORIGINS, "readwrite");
    tx.objectStore(STORE_INLINE_ORIGINS).put(blob, refId);
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveInlineOrigin failed:", e);
    return false;
  }
}

export async function getInlineOrigin(refId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_ORIGINS, "readonly");
    const req = tx.objectStore(STORE_INLINE_ORIGINS).get(refId);
    await txComplete(tx);
    return req.result instanceof Blob ? req.result : null;
  } catch (e) {
    console.warn("[blob-db] getInlineOrigin failed:", e);
    return null;
  }
}

export async function hasInlineOrigin(refId: string): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_ORIGINS, "readonly");
    const req = tx.objectStore(STORE_INLINE_ORIGINS).getKey(refId);
    await txComplete(tx);
    return req.result != null;
  } catch (e) {
    console.warn("[blob-db] hasInlineOrigin failed:", e);
    return false;
  }
}

export async function deleteInlineOrigins(refIds: string[]): Promise<void> {
  if (refIds.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_ORIGINS, "readwrite");
    const store = tx.objectStore(STORE_INLINE_ORIGINS);
    for (const id of refIds) store.delete(id);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteInlineOrigins failed:", e);
  }
}

export async function getInlineOriginKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_INLINE_ORIGINS, "readonly");
    const req = tx.objectStore(STORE_INLINE_ORIGINS).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getInlineOriginKeys failed:", e);
    return [];
  }
}

const INLINE_REF_SCAN_RE = /!\[[^\]]*\]\(inline:([a-zA-Z0-9-]+)\)/g;

function scanInlineRefs(text: string, out: Set<string>): void {
  for (const m of text.matchAll(INLINE_REF_SCAN_RE)) out.add(m[1]);
}

async function collectAllActiveInlineRefs(): Promise<Set<string>> {
  const refs = new Set<string>();
  const sessionData = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(sessionData)) {
    if (!key.startsWith(EDITOR_SESSION_PREFIX)) continue;
    const snap = value as { draft?: { sections?: Record<string, string> } };
    if (!snap?.draft?.sections) continue;
    for (const text of Object.values(snap.draft.sections)) scanInlineRefs(text, refs);
  }
  const localData = await chrome.storage.local.get("bugshot-issues");
  const raw = localData["bugshot-issues"];
  const store = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | { state?: { issues?: Array<{ draft?: { sections?: Record<string, string> } }> } }
    | undefined;
  if (store?.state?.issues) {
    for (const issue of store.state.issues) {
      if (!issue.draft?.sections) continue;
      for (const text of Object.values(issue.draft.sections)) scanInlineRefs(text, refs);
    }
  }
  return refs;
}

export async function pruneOrphanInlineImages(activeRefIds: string[]): Promise<void> {
  try {
    const globalRefs = await collectAllActiveInlineRefs();
    for (const id of activeRefIds) globalRefs.add(id);
    const allKeys = await getInlineImageKeys();
    const orphans = allKeys.filter((k) => !globalRefs.has(k));
    if (orphans.length > 0) await deleteInlineImages(orphans);
    // 원본 백업도 동일 globalRefs로 정리 — markdown에서 사라진 이미지의 원본까지 회수.
    // 별도 globalRefs를 재계산하지 않고 같은 집합을 predicate로 재사용(참조 중 refId 오삭제 방지).
    const originKeys = await getInlineOriginKeys();
    const originOrphans = originKeys.filter((k) => !globalRefs.has(k));
    if (originOrphans.length > 0) await deleteInlineOrigins(originOrphans);
  } catch (e) {
    console.warn("[blob-db] pruneOrphanInlineImages failed:", e);
  }
}

// --- User attachment blob API ---

// owner = `pending:${tabId}`(drafting 중) 또는 issueId(확정 후). id = 파일별 고유 uuid.
function attachmentKey(owner: string, id: string): string {
  return `${owner}:${id}`;
}

export async function saveAttachmentBlob(owner: string, id: string, blob: Blob): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ATTACHMENTS, "readwrite");
    tx.objectStore(STORE_ATTACHMENTS).put(blob, attachmentKey(owner, id));
    await txComplete(tx);
    return true;
  } catch (e) {
    console.warn("[blob-db] saveAttachmentBlob failed:", e);
    return false;
  }
}

export async function getAttachmentBlob(owner: string, id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ATTACHMENTS, "readonly");
    const req = tx.objectStore(STORE_ATTACHMENTS).get(attachmentKey(owner, id));
    await txComplete(tx);
    return req.result instanceof Blob ? req.result : null;
  } catch (e) {
    console.warn("[blob-db] getAttachmentBlob failed:", e);
    return null;
  }
}

export async function deleteAttachmentBlob(owner: string, id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ATTACHMENTS, "readwrite");
    tx.objectStore(STORE_ATTACHMENTS).delete(attachmentKey(owner, id));
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteAttachmentBlob failed:", e);
  }
}

export async function deleteAttachmentBlobs(owner: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ATTACHMENTS, "readwrite");
    const store = tx.objectStore(STORE_ATTACHMENTS);
    const prefix = `${owner}:`;
    await new Promise<void>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of req.result as string[]) {
          if (k.startsWith(prefix)) store.delete(k);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] deleteAttachmentBlobs failed:", e);
  }
}

export async function getAttachmentBlobKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ATTACHMENTS, "readonly");
    const req = tx.objectStore(STORE_ATTACHMENTS).getAllKeys();
    await txComplete(tx);
    return (req.result as string[]) ?? [];
  } catch (e) {
    console.warn("[blob-db] getAttachmentBlobKeys failed:", e);
    return [];
  }
}

export async function clearAttachmentBlobs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ATTACHMENTS, "readwrite");
    tx.objectStore(STORE_ATTACHMENTS).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] clearAttachmentBlobs failed:", e);
  }
}

// pending:${tabId} → issueId 이동. 로그 rekey와 달리 메모리 객체가 없어 read→write→delete 3-step.
export async function rekeyAttachmentBlobs(
  fromOwner: string,
  toOwner: string,
  ids: string[],
): Promise<boolean> {
  let ok = true;
  for (const id of ids) {
    const blob = await getAttachmentBlob(fromOwner, id);
    if (blob == null) continue;
    if (!(await saveAttachmentBlob(toOwner, id, blob))) {
      ok = false;
      continue;
    }
    await deleteAttachmentBlob(fromOwner, id);
  }
  return ok;
}

// --- Utilities ---

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(.*?);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
