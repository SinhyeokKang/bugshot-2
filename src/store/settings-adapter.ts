import { onSettingsReset, onStateSaveFailed } from "@/lib/app-events";
import {
  discardCorruptSettingsEnvelope, transactSettings, withSettingsWriteLock, SettingsCorruptError, SETTINGS_STORAGE_KEY,
} from "@/lib/settings-envelope";
import { applySettingsIntent, type SettingsIntent } from "@/lib/settings-mutations";
import type { SettingsData } from "@/lib/settings-migrations";

export function createSettingsAdapter(publish: (state: SettingsData) => void) {
  const pending: Array<SettingsIntent | { kind: "clearStorage" }> = [];
  let running: Promise<void> | undefined;
  let hydrated = false;
  let generation = 0;
  let wake = 0;
  // emitter는 늦은 구독자에게 재발화하지 않는다 — hydrate가 App 마운트보다 먼저 끝나도 안내가 남게 한다.
  let resetPending = false;
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
          // clearStorage가 진행 중 intent를 대체했으면 그 자리는 이미 비었다.
          if (pending[0] === intent) pending.shift();
          generation++; rebase(state);
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
      let state: SettingsData;
      try {
        ({ state } = await transactSettings(() => {}));
      } catch (error) {
        // 두면 이후 모든 intent가 영구 실패한다 — 폐기는 패널 hydrate만, background는 fail-closed.
        if (!(error instanceof SettingsCorruptError)) throw error;
        await discardCorruptSettingsEnvelope();
        // 지운 직후 래치를 건다 — 이어지는 재조회가 실패해도 다음 hydrate는 null을 정상으로 읽어 안내할 기회가 없다.
        resetPending = true;
        onSettingsReset.fire();
        ({ state } = await transactSettings(() => {}));
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
    enqueue(intent: SettingsIntent) { pending.push(structuredClone(intent)); wake++; void flush(); },
    flush,
    rehydrate,
    hasHydrated: () => hydrated,
    takeSettingsReset() { const was = resetPending; resetPending = false; return was; },
    onFinishHydration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clearStorage() {
      // 앞선 미처리 intent는 어차피 지워진다 — 남기면 그중 영구 실패가 초기화까지 막는다.
      pending.splice(0, pending.length, { kind: "clearStorage" }); wake++;
      return flush();
    },
  };
}
