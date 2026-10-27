import type { EditorSnapshot } from "@/store/editor-store";
import { toLiteSnapshot } from "./liteSnapshot";

const queues = new Map<string, Promise<unknown>>();
export function enqueueEditorSessionWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(key, task);
  void task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
  return task;
}

export function saveEditorSession(key: string, read: () => EditorSnapshot | null): Promise<void> {
  return enqueueEditorSessionWrite(key, async () => {
    const snap = read();
    if (!snap) return;
    try {
      await chrome.storage.session.set({ [key]: snap });
    } catch (error) {
      if (snap.captureMode === "screenshot" && (snap.elementShots || snap.shotSelector)) throw error;
      await chrome.storage.session.set({ [key]: toLiteSnapshot(snap) });
    }
  });
}
