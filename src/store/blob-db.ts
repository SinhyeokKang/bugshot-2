import { LOCALES } from "@/i18n/locales";
import type { AttachmentRetrySnapshot, AttachmentCheckpoint, AttachmentBodyPlan } from "@/types/attachment";
import type { CreatedDestination, RecoverySource, SubmissionRecoveryMeta } from "@/types/attachment";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { EDITOR_SESSION_PREFIX, ISSUES_PERSIST_KEY } from "@/lib/session-keys";
import { INLINE_REF_RE } from "@/lib/inline-ref";

const DB_NAME = "bugshot-video";
const DB_VERSION = 9;
const STORE_VIDEO = "blobs";
const STORE_IMAGES = "images";
const STORE_NETWORK = "networkLogs";
const STORE_CONSOLE = "consoleLogs";
const STORE_ACTION = "actionLogs";
const STORE_INLINE_IMAGES = "inlineImages";
const STORE_INLINE_ORIGINS = "inlineImageOrigins";
const STORE_ATTACHMENTS = "attachments";
const STORE_RECOVERY = "submissionRecovery";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let blocked = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECOVERY)) db.createObjectStore(STORE_RECOVERY);
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
      blocked = true;
      dbPromise = null;
      reject(new Error("Please close other BugShot panels and try again."));
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
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
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
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
    await deleteUnprotectedKeys(STORE_VIDEO, (key) => key === issueId);
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
    await deleteUnprotectedKeys(STORE_VIDEO, () => true);
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
    await deleteUnprotectedKeys(STORE_IMAGES, (key) => key.startsWith(`${issueId}:`));
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
    await deleteUnprotectedKeys(STORE_IMAGES, () => true);
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

async function deleteInlineImages(refIds: string[]): Promise<void> {
  try {
    await deleteUnprotectedKeys(STORE_INLINE_IMAGES, (key) => refIds.includes(key));
  } catch (e) {
    console.warn("[blob-db] deleteInlineImages failed:", e);
  }
}

async function getInlineImageKeys(): Promise<string[]> {
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

// 테스트 전용 export — 프로덕션 호출처 0, blob-db-inline-origins.test.ts가 부른다.
export async function clearInlineImages(): Promise<void> {
  try {
    await deleteUnprotectedKeys(STORE_INLINE_IMAGES, () => true);
  } catch (e) {
    console.warn("[blob-db] clearInlineImages failed:", e);
  }
}

// --- Inline image origin backup API ---
// 어노테이션 직전 원본 백업. inlineImages와 refId 공간을 공유하되 별도 store라 prune 대상 밖
// (markdown에 안 나타나므로). 초기화(reset)로 원본 복원 후 삭제한다. clearInlineOrigins는
// 두지 않는다 — 대칭인 clearInlineImages가 프로덕션 호출처 0이라 대칭 추가도 쓰이지 않는다
// (clearInlineImages 자체는 blob-db-inline-origins.test.ts가 부르므로 dead는 아니다).

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
  try {
    await deleteUnprotectedKeys(STORE_INLINE_ORIGINS, (key) => refIds.includes(key));
  } catch (e) {
    console.warn("[blob-db] deleteInlineOrigins failed:", e);
  }
}

// 테스트 전용 export — 프로덕션 호출처는 같은 파일의 pruneOrphanInlineImages뿐이고,
// blob-db-inline-origins.test.ts가 밖에서 부른다.
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

function scanInlineRefs(text: string, out: Set<string>): void {
  for (const m of text.matchAll(INLINE_REF_RE)) out.add(m[2]);
}

async function collectAllActiveInlineRefs(excludedIssueIds: string[] = []): Promise<Set<string>> {
  const refs = new Set<string>();
  const sessionData = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(sessionData)) {
    if (!key.startsWith(EDITOR_SESSION_PREFIX)) continue;
    const snap = value as { draft?: { sections?: Record<string, string> } };
    if (!snap?.draft?.sections) continue;
    for (const text of Object.values(snap.draft.sections)) scanInlineRefs(text, refs);
  }
  const localData = await chrome.storage.local.get(ISSUES_PERSIST_KEY);
  const raw = localData[ISSUES_PERSIST_KEY];
  const store = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | { state?: { issues?: Array<{ id?: string; draft?: { sections?: Record<string, string> } }> } }
    | undefined;
  if (store?.state?.issues) {
    for (const issue of store.state.issues) {
      if (issue.id && excludedIssueIds.includes(issue.id)) continue;
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
    await deleteUnprotectedKeys(STORE_ATTACHMENTS, (key) => key === attachmentKey(owner, id));
  } catch (e) {
    console.warn("[blob-db] deleteAttachmentBlob failed:", e);
  }
}

export async function deleteAttachmentBlobs(owner: string): Promise<void> {
  try {
    await deleteUnprotectedKeys(STORE_ATTACHMENTS, (key) => key.startsWith(`${owner}:`));
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
    await deleteUnprotectedKeys(STORE_ATTACHMENTS, () => true);
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

// Recovery reads fail closed: malformed metadata must never authorize GC.
const DESTINATION_KEYS: Record<CreatedDestination["platform"], readonly string[]> = {
  jira: ["issueKey", "siteId"], github: ["owner", "repo", "number"], gitlab: ["projectId", "iid"],
  linear: ["issueId"], notion: ["pageId"], asana: ["taskGid"], clickup: ["taskId"],
  slack: ["channelId", "ts"], webhook: ["key", "url"],
};
const ORIGINAL_STORES = [STORE_VIDEO, STORE_IMAGES, STORE_INLINE_IMAGES, STORE_ATTACHMENTS];
const RECOVERY_TRANSITIONS: Record<SubmissionRecoveryMeta["phase"], readonly SubmissionRecoveryMeta["phase"][]> = {
  prepared: ["creating"], creating: ["created", "unknown"], created: ["partial", "complete"],
  partial: ["partial", "complete"], complete: [], unknown: ["created"],
};

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Invalid recovery metadata");
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function safeDestinationUrl(value: unknown): boolean {
  if (!nonempty(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && ![...url.searchParams.keys()].some((key) => /^(x-amz-|x-goog-)|^(signature|sig|token|access_token|api_key|AWSAccessKeyId|GoogleAccessId)$/i.test(key));
  } catch { return false; }
}
function validateFailure(value: unknown): void {
  const failure = record(value, ["stage", "code", "httpStatus"]);
  if (!["source", "upload", "link", "body"].includes(String(failure.stage))
    || !["missing-source", "local-storage", "authentication", "permission", "size-limit", "rate-limit", "network", "timeout", "invalid-response", "body-limit", "unknown"].includes(String(failure.code))
    || (failure.httpStatus !== undefined && (!Number.isInteger(failure.httpStatus) || Number(failure.httpStatus) < 100 || Number(failure.httpStatus) > 599))) throw new Error("Invalid recovery failure");
}
function validateRetrySnapshot(value: unknown, ids: Set<string>, platform: string): void {
  const snapshot = record(value, ["schemaVersion", "accountIdentity", "bodyLocale", "checkpoints", "bodyPlan", "revision"]);
  if (snapshot.schemaVersion !== 1 || !nonempty(snapshot.accountIdentity)
    || !(LOCALES as readonly unknown[]).includes(snapshot.bodyLocale) || !Number.isSafeInteger(snapshot.revision) || Number(snapshot.revision) < 0
    || !Array.isArray(snapshot.checkpoints) || platform === "webhook") throw new Error("Invalid retry snapshot");
  const seen = new Set<string>();
  for (const value of snapshot.checkpoints) {
    const cp = record(value, ["fileId", "upload", "link", "body", "uploaded", "linkedId"]);
    if (!nonempty(cp.fileId) || !ids.has(cp.fileId) || seen.has(cp.fileId)
      || !["pending", "done", "failed", "unknown"].includes(String(cp.upload))
      || !["pending", "done", "failed", "unknown", "not-applicable"].includes(String(cp.link))
      || !["pending", "done", "failed", "unknown", "conflict", "not-applicable"].includes(String(cp.body))
      || (cp.linkedId !== undefined && !nonempty(cp.linkedId))) throw new Error("Invalid file checkpoint");
    seen.add(cp.fileId);
    if (cp.uploaded !== undefined) {
      const allowed: Record<string, string[]> = {
        github: ["platform", "href", "id"], gitlab: ["platform", "href", "id"], linear: ["platform", "href", "id"], clickup: ["platform", "href", "id"],
        jira: ["platform", "id", "href", "mediaId"], asana: ["platform", "id", "href"], notion: ["platform", "id", "expiresAt"], slack: ["platform", "id"],
      };
      const remote = record(cp.uploaded, allowed[platform] ?? []);
      if (remote.platform !== platform || (remote.href !== undefined && !safeDestinationUrl(remote.href))
        || (["github", "gitlab", "linear", "clickup", "jira"].includes(platform) && !safeDestinationUrl(remote.href))
        || (["jira", "asana", "notion", "slack"].includes(platform) && !nonempty(remote.id))
        || (remote.id !== undefined && !nonempty(remote.id)) || (remote.mediaId !== undefined && !nonempty(remote.mediaId))
        || (platform === "notion" && (typeof remote.expiresAt !== "number" || !Number.isFinite(remote.expiresAt)))) throw new Error("Invalid uploaded locator");
    }
    if (cp.upload === "done" && !cp.uploaded) throw new Error("Missing uploaded locator");
  }
  if (seen.size !== ids.size) throw new Error("Missing file checkpoint");
  const plan = record(snapshot.bodyPlan, ["format", "lastWritten", "replacements"]);
  if (!["markdown", "adf", "asana-html", "notion-blocks", "slack-thread"].includes(String(plan.format)) || typeof plan.lastWritten !== "string" || !Array.isArray(plan.replacements)) throw new Error("Invalid body plan");
  for (const value of plan.replacements) {
    const item = record(value, ["fileId", "anchor", "before", "after", "renderTemplate"]);
    if (!nonempty(item.fileId) || !ids.has(item.fileId) || typeof item.anchor !== "string" || typeof item.before !== "string" || typeof item.renderTemplate !== "string" || (item.after !== undefined && typeof item.after !== "string")) throw new Error("Invalid body replacement");
  }
}

function validateRecovery(value: unknown): SubmissionRecoveryMeta {
  const meta = record(value, ["attemptId", "issueId", "title", "platform", "createdAt", "expiresAt", "phase", "destination", "files", "results", "updatedAt", "localFilesRemoved", "submissionFailure", "retrySnapshot"]);
  if (!nonempty(meta.attemptId) || !nonempty(meta.issueId) || typeof meta.title !== "string"
    || typeof meta.platform !== "string" || !Object.hasOwn(DESTINATION_KEYS, meta.platform)
    || typeof meta.phase !== "string" || !Object.hasOwn(RECOVERY_TRANSITIONS, meta.phase)
    || ![meta.createdAt, meta.expiresAt, meta.updatedAt].every((n) => typeof n === "number" && Number.isFinite(n))
    || !Array.isArray(meta.files) || !Array.isArray(meta.results)) throw new Error("Invalid recovery metadata");
  if (meta.localFilesRemoved !== undefined && typeof meta.localFilesRemoved !== "boolean") throw new Error("Invalid recovery expiry marker");
  const ids = new Set<string>();
  for (const value of meta.files) {
    const file = record(value, ["id", "kind", "filename", "contentType", "source", "originalSource"]);
    if (!nonempty(file.id) || ids.has(file.id) || !["capture", "video", "inline", "logs", "user"].includes(String(file.kind))
      || typeof file.filename !== "string" || typeof file.contentType !== "string") throw new Error("Invalid recovery file");
    if (file.originalSource !== undefined) {
      const original = record(file.originalSource, ["kind", "store", "key"]);
      if (original.kind !== "original" || !ORIGINAL_STORES.includes(String(original.store)) || !nonempty(original.key)) throw new Error("Invalid original recovery source");
    }
    ids.add(file.id);
    const source = record(file.source, ["kind", "store", "key"]);
    if (!nonempty(source.key) || (source.kind !== "original" && source.kind !== "generated")
      || (source.kind === "original" && !ORIGINAL_STORES.includes(String(source.store)))
      || (source.kind === "generated" && (source.store !== undefined || source.key !== `file:${meta.attemptId}:${file.id}`))) {
      throw new Error("Invalid recovery source");
    }
  }
  if (meta.retrySnapshot !== undefined) validateRetrySnapshot(meta.retrySnapshot, ids, String(meta.platform));
  if (meta.submissionFailure !== undefined) validateFailure(meta.submissionFailure);
  const resultIds = new Set<string>();
  for (const value of meta.results) {
    const result = record(value, ["fileId", "delivery", "presentation", "failure"]);
    if (!nonempty(result.fileId) || !ids.has(result.fileId) || resultIds.has(result.fileId)
      || !["attached", "failed", "unknown"].includes(String(result.delivery))
      || !["complete", "failed", "not-applicable"].includes(String(result.presentation))) throw new Error("Invalid recovery result");
    resultIds.add(result.fileId);
    if (result.failure !== undefined) {
      validateFailure(result.failure);
    }
  }
  if (meta.destination !== undefined) {
    const remote = record(meta.destination, ["platform", "key", "url", "locator"]);
    if (remote.platform !== meta.platform || !nonempty(remote.key) || (remote.url !== undefined && !safeDestinationUrl(remote.url))) throw new Error("Invalid recovery destination");
    const allowed = DESTINATION_KEYS[remote.platform as CreatedDestination["platform"]];
    const locator = record(remote.locator, allowed);
    if (allowed.some((key) => !nonempty(locator[key]))
      || (remote.platform === "webhook" && !safeDestinationUrl(locator.url))) throw new Error("Invalid recovery locator");
  }
  if (["created", "partial", "complete"].includes(meta.phase) && !meta.destination) throw new Error("Missing recovery destination");
  if (meta.phase === "complete" && (meta.submissionFailure !== undefined || resultIds.size !== ids.size
    || meta.results.some((r) => r.delivery !== "attached" || r.presentation === "failed" || r.failure !== undefined))) throw new Error("Incomplete recovery results");
  return value as SubmissionRecoveryMeta;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function recoveryTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = txComplete(tx);
  // Observe abort immediately even when a request rejects before awaiting completion.
  void done.catch(() => {});
  try {
    const result = await run(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* It may already have aborted. */ }
    await done.catch(() => {});
    throw error;
  }
}

async function recoveriesIn(tx: IDBTransaction): Promise<SubmissionRecoveryMeta[]> {
  const range = IDBKeyRange.bound("attempt:", "attempt:\uffff");
  const values: unknown[] = await requestResult(tx.objectStore(STORE_RECOVERY).getAll(range));
  const keys = await requestResult(tx.objectStore(STORE_RECOVERY).getAllKeys(range));
  return values.map((value, index) => {
    const meta = validateRecovery(value);
    if (keys[index] !== `attempt:${meta.issueId}`) throw new Error("Invalid recovery issue key");
    return meta;
  });
}

export async function beginSubmissionRecovery(meta: SubmissionRecoveryMeta, generated: Map<string, Blob>): Promise<void> {
  const snapshot = validateRecovery(structuredClone(meta));
  const blobs = new Map(generated);
  if (snapshot.phase !== "prepared" || snapshot.destination || snapshot.results.length || snapshot.submissionFailure) throw new Error("Recovery must begin prepared");
  const expected = snapshot.files.filter((f) => f.source.kind === "generated").map((f) => f.source.key);
  if (blobs.size !== expected.length || expected.some((key) => !(blobs.get(key) instanceof Blob))) throw new Error("Missing generated recovery file");
  await recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    const key = `attempt:${snapshot.issueId}`;
    if (await requestResult(store.getKey(key)) !== undefined) throw new Error("Submission recovery already exists");
    for (const source of snapshot.files.flatMap(originalRecoverySources)) {
      if (source.kind === "original" && !(await requestResult(tx.objectStore(source.store).get(source.key)) instanceof Blob)) throw new Error("Missing original recovery file");
    }
    store.put(snapshot, key);
    for (const [key, blob] of blobs) {
      if (await requestResult(store.getKey(key)) !== undefined) throw new Error("Recovery file key already exists");
      store.put(blob, key);
    }
  });
}

export async function checkpointSubmission(
  issueId: string,
  attemptId: string,
  patch: Pick<SubmissionRecoveryMeta, "phase" | "destination" | "results" | "submissionFailure">,
): Promise<void> {
  const update = structuredClone(patch);
  await recoveryTransaction([STORE_RECOVERY], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    if (!RECOVERY_TRANSITIONS[current.phase].includes(update.phase)) throw new Error("Invalid recovery transition");
    let destination = update.destination ?? current.destination;
    if (current.destination && update.destination) {
      const previous = current.destination;
      const incoming = update.destination;
      if (previous.platform !== incoming.platform || previous.key !== incoming.key
        || Object.entries(previous.locator).some(([key, value]) => (incoming.locator as Record<string, string>)[key] !== value)
        || (previous.url && incoming.url && previous.url !== incoming.url)) throw new Error("Recovery destination cannot change");
      destination = { ...incoming, url: incoming.url ?? previous.url };
    }
    const next = validateRecovery({ ...current, phase: update.phase, results: update.results, submissionFailure: update.submissionFailure,
      destination, updatedAt: Math.max(Date.now(), current.updatedAt + 1) });
    store.put(next, `attempt:${issueId}`);
  });
}

async function requireAttempt(store: IDBObjectStore, issueId: string, attemptId: string): Promise<SubmissionRecoveryMeta> {
  const value: unknown = await requestResult(store.get(`attempt:${issueId}`));
  if (value === undefined) throw new Error("Submission recovery no longer exists");
  const meta = validateRecovery(value);
  if (meta.issueId !== issueId || meta.attemptId !== attemptId) throw new Error("Stale submission attempt");
  return meta;
}

export async function readSubmissionRecovery(issueId: string): Promise<SubmissionRecoveryMeta | null> {
  return recoveryTransaction([STORE_RECOVERY], "readonly", async (tx) => {
    const value: unknown = await requestResult(tx.objectStore(STORE_RECOVERY).get(`attempt:${issueId}`));
    if (value === undefined) return null;
    const meta = validateRecovery(value);
    if (meta.issueId !== issueId) throw new Error("Invalid recovery issue key");
    return meta;
  });
}

export async function listSubmissionRecoveries(): Promise<SubmissionRecoveryMeta[]> {
  return recoveryTransaction([STORE_RECOVERY], "readonly", recoveriesIn);
}

export async function readRecoveryFile(meta: SubmissionRecoveryMeta, fileId: string): Promise<Blob | null> {
  return recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES], "readonly", async (tx) => {
    const value: unknown = await requestResult(tx.objectStore(STORE_RECOVERY).get(`attempt:${meta.issueId}`));
    if (value === undefined) return null;
    const current = validateRecovery(value);
    if (current.issueId !== meta.issueId) throw new Error("Invalid recovery issue key");
    if (current.attemptId !== meta.attemptId || current.localFilesRemoved) return null;
    const source = current.files.find((file) => file.id === fileId)?.source;
    if (!source) return null;
    const blob: unknown = await requestResult(tx.objectStore(source.kind === "original" ? source.store : STORE_RECOVERY).get(source.key));
    return blob instanceof Blob ? blob : null;
  });
}

function deleteJournal(store: IDBObjectStore, meta: SubmissionRecoveryMeta): void {
  for (const file of meta.files) if (file.source.kind === "generated") store.delete(file.source.key);
  store.delete(`attempt:${meta.issueId}`);
}

export async function deleteSubmissionRecovery(issueId: string, attemptId: string): Promise<void> {
  await recoveryTransaction([STORE_RECOVERY], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    deleteJournal(store, await requireAttempt(store, issueId, attemptId));
  });
}

export async function deleteOriginalKeys(issueId: string, attemptId: string, sources: RecoverySource[]): Promise<void> {
  const requested = structuredClone(sources);
  const inlineRefs = await collectAllActiveInlineRefs([issueId]);
  await recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES], "readwrite", async (tx) => {
    const current = await requireAttempt(tx.objectStore(STORE_RECOVERY), issueId, attemptId);
    if (current.phase !== "partial" && current.phase !== "complete") throw new Error("Recovery is not finalized");
    const retained = (await recoveriesIn(tx)).filter((meta) => meta.issueId !== issueId);
    for (const source of requested) {
      if (source.kind !== "original") continue;
      const files = current.files.filter((f) => originalRecoverySources(f).some((s) => s.store === source.store && s.key === source.key));
      if (!files.length || files.some((file) => !current.results.some((r) => r.fileId === file.id && r.delivery === "attached" && r.presentation !== "failed" && !r.failure))) {
        throw new Error("Cannot delete incomplete recovery source");
      }
      if ((source.store === STORE_INLINE_IMAGES && inlineRefs.has(source.key))
        || retained.some((meta) => protectsSource(meta, source.store, source.key))) continue;
      tx.objectStore(source.store).delete(source.key);
    }
  });
}

export async function purgeRecoveryForIssues(issueIds: string[]): Promise<void> {
  if (!issueIds.length) return;
  const inlineRefs = await collectAllActiveInlineRefs(issueIds);
  await recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES], "readwrite", async (tx) => {
    const all = await recoveriesIn(tx);
    const retained = all.filter((meta) => !issueIds.includes(meta.issueId));
    for (const meta of all.filter((meta) => issueIds.includes(meta.issueId))) {
      for (const source of meta.files.flatMap(originalRecoverySources)) {
        if (source.kind === "original" && !(source.store === STORE_INLINE_IMAGES && inlineRefs.has(source.key))
          && !retained.some((other) => protectsSource(other, source.store, source.key))) tx.objectStore(source.store).delete(source.key);
      }
      deleteJournal(tx.objectStore(STORE_RECOVERY), meta);
    }
  });
}

function protectsSource(meta: SubmissionRecoveryMeta, store: string, key: string): boolean {
  return !meta.localFilesRemoved && meta.files.some((file) => originalRecoverySources(file).some((source) => source.store === store && source.key === key));
}

async function deleteUnprotectedKeys(storeName: string, matches: (key: string) => boolean): Promise<void> {
  await recoveryTransaction([STORE_RECOVERY, storeName], "readwrite", async (tx) => {
    const live = await recoveriesIn(tx);
    const store = tx.objectStore(storeName);
    const keys = await requestResult(store.getAllKeys());
    const protectedStore = storeName === STORE_INLINE_ORIGINS ? STORE_INLINE_IMAGES : storeName;
    for (const key of keys) {
      if (typeof key === "string" && matches(key) && !live.some((meta) => protectsSource(meta, protectedStore, key))) store.delete(key);
    }
  });
}

export async function readOriginalRecoverySource(source: Extract<RecoverySource, { kind: "original" }>): Promise<Blob | null> {
  return recoveryTransaction([source.store], "readonly", async (tx) => {
    const value: unknown = await requestResult(tx.objectStore(source.store).get(source.key));
    return value instanceof Blob ? value : null;
  });
}

export async function dismissUnknownSubmission(issueId: string, attemptId: string): Promise<void> {
  await recoveryTransaction([STORE_RECOVERY], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    if (current.phase !== "unknown" || current.destination) throw new Error("Submission is not unknown");
    deleteJournal(store, current);
  });
}

function originalRecoverySources(file: SubmissionRecoveryMeta["files"][number]): Array<Extract<RecoverySource, { kind: "original" }>> {
  return [...(file.source.kind === "original" ? [file.source] : []), ...(file.originalSource ? [file.originalSource] : [])];
}

export async function expireSubmissionRecovery(issueId: string, attemptId: string, now = Date.now()): Promise<void> {
  const expiredIds = (await listSubmissionRecoveries()).filter((meta) => meta.expiresAt <= now).map((meta) => meta.issueId);
  const inlineRefs = await collectAllActiveInlineRefs(expiredIds);
  await recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES], "readwrite", async (tx) => {
    const current = await requireAttempt(tx.objectStore(STORE_RECOVERY), issueId, attemptId);
    if (current.expiresAt > now) return;
    const retained = (await recoveriesIn(tx)).filter((meta) => meta.issueId !== issueId && meta.expiresAt > now);
    for (const source of current.files.flatMap(originalRecoverySources)) {
      if (!(source.store === STORE_INLINE_IMAGES && inlineRefs.has(source.key))
        && !retained.some((other) => protectsSource(other, source.store, source.key))) tx.objectStore(source.store).delete(source.key);
    }
    for (const { source } of current.files) if (source.kind === "generated") tx.objectStore(STORE_RECOVERY).delete(source.key);
    tx.objectStore(STORE_RECOVERY).put({ ...current, localFilesRemoved: true }, `attempt:${issueId}`);
  });
}

export async function removeSubmissionRecoveryFiles(issueId: string, attemptId: string): Promise<void> {
  const inlineRefs = await collectAllActiveInlineRefs([issueId]);
  const local = await chrome.storage.local.get(ISSUES_PERSIST_KEY);
  const raw = local[ISSUES_PERSIST_KEY];
  const persisted = typeof raw === "string" ? JSON.parse(raw) : raw;
  const owner = persisted?.state?.issues?.find((issue: { id: string }) => issue.id === issueId);
  await recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    if (current.phase !== "partial" && current.phase !== "unknown") throw new Error("Recovery is not settled");
    const retained = (await recoveriesIn(tx)).filter((meta) => meta.issueId !== issueId && meta.expiresAt > Date.now());
    if (current.platform !== "slack" && !owner?.slackPreserved) {
      for (const source of current.files.flatMap(originalRecoverySources)) {
        // Non-inline originals belong to their issue key; never delete another owner's bytes.
        if (source.store !== STORE_INLINE_IMAGES && source.key !== issueId && !source.key.startsWith(`${issueId}:`)) continue;
        if ((source.store === STORE_INLINE_IMAGES && inlineRefs.has(source.key))
          || retained.some((other) => protectsSource(other, source.store, source.key))) continue;
        tx.objectStore(source.store).delete(source.key);
      }
    }
    for (const { source } of current.files) if (source.kind === "generated") store.delete(source.key);
    store.put({ ...current, localFilesRemoved: true, updatedAt: Math.max(Date.now(), current.updatedAt + 1) }, `attempt:${issueId}`);
  });
}

export async function cleanupSubmissionOriginals(issueId: string, attemptId: string): Promise<void> {
  const inlineRefs = await collectAllActiveInlineRefs([issueId]);
  await recoveryTransaction([STORE_RECOVERY, ...ORIGINAL_STORES, STORE_NETWORK, STORE_CONSOLE, STORE_ACTION], "readwrite", async (tx) => {
    const current = await requireAttempt(tx.objectStore(STORE_RECOVERY), issueId, attemptId);
    if (current.phase !== "partial" && current.phase !== "complete") throw new Error("Recovery is not finalized");
    const completed = (file: SubmissionRecoveryMeta["files"][number]) => current.results.some((r) => r.fileId === file.id && r.delivery === "attached" && r.presentation !== "failed" && !r.failure);
    for (const file of current.files) {
      if (file.source.kind === "generated" && completed(file)) tx.objectStore(STORE_RECOVERY).delete(file.source.key);
    }
    if (current.platform === "slack") return;
    const retained = (await recoveriesIn(tx)).filter((meta) => meta.issueId !== issueId);
    const incomplete = current.files.filter((file) => !completed(file)).flatMap(originalRecoverySources);
    for (const storeName of ORIGINAL_STORES) {
      const store = tx.objectStore(storeName);
      const referenced = current.files.flatMap(originalRecoverySources).filter((s) => s.store === storeName).map((s) => s.key);
      const keys = await requestResult(store.getAllKeys());
      for (const key of keys) {
        if (typeof key !== "string" || !(referenced.includes(key) || (storeName !== STORE_INLINE_IMAGES && (key === issueId || key.startsWith(`${issueId}:`))))) continue;
        if (incomplete.some((s) => s.store === storeName && s.key === key)
          || (storeName === STORE_INLINE_IMAGES && inlineRefs.has(key))
          || retained.some((meta) => protectsSource(meta, storeName, key))) continue;
        store.delete(key);
      }
    }
    for (const store of [STORE_NETWORK, STORE_CONSOLE, STORE_ACTION]) tx.objectStore(store).delete(issueId);
  });
}

export async function discardPreparedSubmission(issueId: string, attemptId: string): Promise<void> {
  await recoveryTransaction([STORE_RECOVERY], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    if (current.phase !== "prepared") throw new Error("Submission has started");
    deleteJournal(store, current);
  });
}

export async function discardRejectedSubmission(issueId: string, attemptId: string): Promise<void> {
  await recoveryTransaction([STORE_RECOVERY], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    if (current.destination || (current.phase !== "creating" && current.phase !== "unknown")) throw new Error("Submission creation cannot be rejected");
    deleteJournal(store, current);
  });
}

export async function initializeAttachmentRetry(issueId: string, attemptId: string, snapshot: AttachmentRetrySnapshot): Promise<void> {
  const value = structuredClone(snapshot);
  await recoveryTransaction([STORE_RECOVERY], "readwrite", async tx => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    if (current.phase !== "prepared" || current.retrySnapshot || value.revision !== 0 || current.localFilesRemoved) throw new Error("Retry snapshot cannot be initialized");
    store.put(validateRecovery({ ...current, retrySnapshot: value, updatedAt: Math.max(Date.now(), current.updatedAt + 1) }), `attempt:${issueId}`);
  });
}

export async function checkpointAttachmentRetry(issueId: string, attemptId: string, expectedRevision: number,
  patch: { checkpoint?: AttachmentCheckpoint; bodyPlan?: AttachmentBodyPlan }): Promise<number> {
  const update = structuredClone(patch);
  return recoveryTransaction([STORE_RECOVERY], "readwrite", async tx => {
    const store = tx.objectStore(STORE_RECOVERY);
    const current = await requireAttempt(store, issueId, attemptId);
    const snapshot = current.retrySnapshot;
    if (!snapshot || snapshot.revision !== expectedRevision || current.localFilesRemoved || current.phase === "complete" || current.phase === "unknown") throw new Error("Stale retry revision or unavailable recovery");
    if (update.checkpoint && !snapshot.checkpoints.some(cp => cp.fileId === update.checkpoint!.fileId)) throw new Error("Unknown retry file");
    const revision = expectedRevision + 1;
    const next = validateRecovery({ ...current, updatedAt: Math.max(Date.now(), current.updatedAt + 1), retrySnapshot: {
      ...snapshot, revision,
      checkpoints: snapshot.checkpoints.map(cp => cp.fileId === update.checkpoint?.fileId ? update.checkpoint : cp),
      bodyPlan: update.bodyPlan ?? snapshot.bodyPlan,
    } });
    store.put(next, `attempt:${issueId}`);
    return revision;
  });
}
