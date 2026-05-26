import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import { EDITOR_SESSION_PREFIX } from "@/lib/session-keys";

const DB_NAME = "bugshot-video";
const DB_VERSION = 5;
const STORE_VIDEO = "blobs";
const STORE_IMAGES = "images";
const STORE_NETWORK = "networkLogs";
const STORE_CONSOLE = "consoleLogs";
const STORE_INLINE_IMAGES = "inlineImages";

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
      if (!db.objectStoreNames.contains(STORE_INLINE_IMAGES)) {
        db.createObjectStore(STORE_INLINE_IMAGES);
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
    return (req.result as Blob) ?? null;
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

export type ImageSlot = "before" | "after";

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
    return (req.result as Blob) ?? null;
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
    store.delete(imageKey(issueId, "before"));
    store.delete(imageKey(issueId, "after"));
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
    return (req.result as Blob) ?? null;
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

const INLINE_REF_SCAN_RE = /!\[[^\]]*\]\(inline:([a-zA-Z0-9-]+)\)/g;

function scanInlineRefs(text: string, out: Set<string>): void {
  for (const m of text.matchAll(INLINE_REF_SCAN_RE)) out.add(m[1]);
}

async function collectAllActiveInlineRefs(): Promise<Set<string>> {
  const refs = new Set<string>();
  try {
    const sessionData = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(sessionData)) {
      if (!key.startsWith(EDITOR_SESSION_PREFIX)) continue;
      const snap = value as { draft?: { sections?: Record<string, string> } };
      if (!snap?.draft?.sections) continue;
      for (const text of Object.values(snap.draft.sections)) scanInlineRefs(text, refs);
    }
  } catch { /* session storage unavailable */ }
  try {
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
  } catch { /* local storage unavailable or parse error */ }
  return refs;
}

export async function pruneOrphanInlineImages(activeRefIds: string[]): Promise<void> {
  try {
    const globalRefs = await collectAllActiveInlineRefs();
    for (const id of activeRefIds) globalRefs.add(id);
    const allKeys = await getInlineImageKeys();
    const orphans = allKeys.filter((k) => !globalRefs.has(k));
    if (orphans.length > 0) await deleteInlineImages(orphans);
  } catch (e) {
    console.warn("[blob-db] pruneOrphanInlineImages failed:", e);
  }
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
