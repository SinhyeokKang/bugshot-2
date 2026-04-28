const DB_NAME = "bugshot-video";
const DB_VERSION = 2;
const STORE_VIDEO = "blobs";
const STORE_IMAGES = "images";

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
    };
    req.onsuccess = () => resolve(req.result);
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

// --- Video blob API (unchanged) ---

export async function saveVideoBlob(issueId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_VIDEO, "readwrite");
    tx.objectStore(STORE_VIDEO).put(blob, issueId);
    await txComplete(tx);
  } catch (e) {
    console.warn("[blob-db] saveVideoBlob failed:", e);
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
): Promise<void> {
  try {
    await saveImageBlobRaw(issueId, slot, blob);
  } catch (e) {
    console.warn("[blob-db] saveImageBlob failed:", e);
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

// --- Utilities ---

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(.*?);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
