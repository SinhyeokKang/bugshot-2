const DB_NAME = "bugshot-video";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
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

export async function saveVideoBlob(issueId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, issueId);
    await txComplete(tx);
  } catch (e) {
    console.warn("[video-db] saveVideoBlob failed:", e);
  }
}

export async function getVideoBlob(issueId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(issueId);
    await txComplete(tx);
    return (req.result as Blob) ?? null;
  } catch (e) {
    console.warn("[video-db] getVideoBlob failed:", e);
    return null;
  }
}

export async function deleteVideoBlob(issueId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(issueId);
    await txComplete(tx);
  } catch (e) {
    console.warn("[video-db] deleteVideoBlob failed:", e);
  }
}

export async function clearVideoBlobs(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    await txComplete(tx);
  } catch (e) {
    console.warn("[video-db] clearVideoBlobs failed:", e);
  }
}
