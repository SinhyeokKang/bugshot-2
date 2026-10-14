import { onStateSaveFailed } from "@/lib/app-events";
import { transactSettings, withSettingsWriteLock, SETTINGS_STORAGE_KEY } from "@/lib/settings-envelope";
import { applySettingsIntent, type SettingsIntent } from "@/lib/settings-mutations";
import type { SettingsData } from "@/lib/settings-migrations";

export function createSettingsAdapter(publish: (state: SettingsData) => void) {
  const pending: Array<SettingsIntent | { kind: "clearStorage" }> = [];
  let running: Promise<void> | undefined;
  let hydrated = false;
  let generation = 0;
  let wake = 0;
  const listeners = new Set<() => void>();
  function rebase(state: SettingsData) {
    publish(pending.reduce((current, intent) => intent.kind === "clearStorage"
      ? { accounts: {}, lastSubmitFields: {}, titlePrefix: "" }
      : applySettingsIntent(current, intent), state));
  }
  function flush(): Promise<void> {
    if (running) return running;
    running = (async () => {
      while (pending.length) {
        const intent = pending[0];
        const attemptWake = wake;
        try {
          const state = intent.kind === "clearStorage"
            ? await withSettingsWriteLock(async () => {
                await chrome.storage.local.remove(SETTINGS_STORAGE_KEY);
                return { accounts: {}, lastSubmitFields: {}, titlePrefix: "" };
              })
            : (await transactSettings((latest) => Object.assign(latest, applySettingsIntent(latest, intent)))).state;
          pending.shift(); generation++; rebase(state);
        } catch {
          onStateSaveFailed.fire();
          if (attemptWake === wake) break;
        }
      }
    })().finally(() => { running = undefined; });
    return running;
  }
  async function rehydrate() {
    const start = ++generation;
    wake++;
    try {
      const { state } = await transactSettings(() => {});
      if (start === generation) rebase(state);
    } catch { onStateSaveFailed.fire(); }
    finally {
      hydrated = true;
      listeners.forEach((listener) => listener());
    }
    if (pending.length) await flush();
  }
  return {
    enqueue(intent: SettingsIntent) { pending.push(structuredClone(intent)); wake++; void flush(); },
    flush,
    rehydrate,
    hasHydrated: () => hydrated,
    onFinishHydration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clearStorage() {
      pending.push({ kind: "clearStorage" }); wake++;
      return flush();
    },
  };
}
