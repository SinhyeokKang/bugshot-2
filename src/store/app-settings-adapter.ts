import { onSettingsReset, onStateSaveFailed } from "@/lib/app-events";
import { APP_SETTINGS_PERSIST_KEY } from "@/lib/session-keys";
import { deobfuscateApiKey, obfuscateApiKey } from "@/lib/key-obfuscation";
import type { SettingsUiData } from "./settings-ui-store";

export type AppSettingsIntent = (latest: SettingsUiData) => Partial<SettingsUiData>;
const VERSION = 12;
const WRITE_LOCK = "bugshot-app-settings-write";
class AppSettingsCorruptError extends Error {}

async function withWriteLock<T>(run: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) throw Error("App settings lock unavailable");
  return navigator.locks.request(WRITE_LOCK, { mode: "exclusive" }, run);
}

export function createAppSettingsAdapter(
  normalize: (state: unknown, version: number) => SettingsUiData,
  publish: (state: SettingsUiData) => void,
) {
  const pending: AppSettingsIntent[] = [];
  let running: Promise<void> | undefined;
  let generation = 0;
  let wake = 0;
  let hydrated = false;
  let resetPending = false;
  const listeners = new Set<() => void>();

  async function read() {
    const result = await chrome.storage.local.get(APP_SETTINGS_PERSIST_KEY);
    const raw = result[APP_SETTINGS_PERSIST_KEY];
    // Only decoding/shape errors count as corruption; I/O and lock failures never authorize deletion.
    try {
      const envelope = raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
      if (envelope !== null && (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
        || !envelope.state || typeof envelope.state !== "object" || Array.isArray(envelope.state)
        || (envelope.version !== undefined && (!Number.isSafeInteger(envelope.version) || envelope.version < 0)))) {
        throw new AppSettingsCorruptError();
      }
      const before = JSON.stringify(envelope);
      const version = envelope?.version ?? 0;
      const stored = envelope?.state;
      if (stored?.llm?.apiKey) stored.llm.apiKey = deobfuscateApiKey(stored.llm.apiKey);
      return { raw, envelope, before, version, state: normalize(stored, version) };
    } catch { throw new AppSettingsCorruptError(); }
  }
  async function discardCorrupt() {
    await withWriteLock(async () => {
      try { await read(); return; }
      catch (error) { if (!(error instanceof AppSettingsCorruptError)) throw error; }
      await chrome.storage.local.remove(APP_SETTINGS_PERSIST_KEY);
      // Latch immediately: the following read may fail, or UI subscription may not exist yet.
      resetPending = true;
      onSettingsReset.fire();
    });
  }
  async function transact(intent?: AppSettingsIntent): Promise<SettingsUiData> {
    return withWriteLock(async () => {
      const { raw, envelope, before, version, state } = await read();
      const next = intent ? { ...state, ...intent(state) } : state;
      // Hydration is read-only except for legacy migration; an echo never starts a write cycle.
      if (intent || (envelope !== null && version < VERSION)) {
        const encoded = { ...next, llm: next.llm ? { ...next.llm, apiKey: obfuscateApiKey(next.llm.apiKey) } : null };
        const updated = { ...envelope, state: encoded, version: Math.max(version, VERSION) };
        if (JSON.stringify(updated) !== before) {
          await chrome.storage.local.set({ [APP_SETTINGS_PERSIST_KEY]: typeof raw === "string" || raw == null ? JSON.stringify(updated) : updated });
        }
      }
      return next;
    });
  }

  function rebase(state: SettingsUiData) {
    publish(pending.reduce((current, intent) => ({ ...current, ...intent(current) }), state));
  }
  function flush(): Promise<void> {
    if (running) return running;
    running = (async () => {
      while (pending.length) {
        const intent = pending[0];
        const attemptWake = wake;
        try {
          const state = await transact(intent);
          pending.shift();
          generation++;
          rebase(state);
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
      let state: SettingsUiData;
      try { state = await transact(); }
      catch (error) {
        if (!(error instanceof AppSettingsCorruptError)) throw error;
        await discardCorrupt();
        state = await transact();
      }
      if (start === generation) rebase(state);
    } catch { onStateSaveFailed.fire(); }
    finally {
      hydrated = true;
      listeners.forEach((listener) => listener());
    }
    if (pending.length) await flush();
  }
  return {
    enqueue(intent: AppSettingsIntent) { pending.push(intent); wake++; void flush(); },
    flush,
    rehydrate,
    hasHydrated: () => hydrated,
    takeSettingsReset() { const was = resetPending; resetPending = false; return was; },
    onFinishHydration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
