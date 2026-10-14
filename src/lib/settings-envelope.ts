import { t } from "@/i18n";
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";
import { migrateSettings, SETTINGS_STORE_VERSION, type SettingsData } from "./settings-migrations";

export const SETTINGS_STORAGE_KEY = "bugshot-settings";
export const SETTINGS_WRITE_LOCK = "bugshot-settings-write";
export interface SettingsEnvelope { state: SettingsData; version?: number; [key: string]: unknown }
export class SettingsStorageError extends Error {}
// 형식 검증 실패만 — read/lock 실패는 일시적이라 격리 대상이 아니다.
export class SettingsCorruptError extends SettingsStorageError {
  constructor() { super(t("app.settingsStorage.corrupt")); }
}
// missing: 저장소에 그 계정이 없다(다른 패널에서 해제). replaced: 같은 자리에 다른 grant가 있다.
export class StaleGrantError extends Error {
  constructor(platform: PlatformId, readonly reason: "missing" | "replaced") {
    const name = t(PLATFORM_TAB_KEYS[platform]);
    super(reason === "missing"
      ? t("platform.notConnected.title", { platform: name })
      : t("platform.accountChanged.title", { platform: name }));
  }
}

export async function withSettingsWriteLock<T>(run: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) throw new SettingsStorageError(t("app.settingsStorage.unavailable"));
  return navigator.locks.request(SETTINGS_WRITE_LOCK, { mode: "exclusive" }, run);
}

export async function readSettingsEnvelope() {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = result[SETTINGS_STORAGE_KEY];
  if (raw == null) return { raw, envelope: null };
  let parsed: unknown;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { throw new SettingsCorruptError(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !(parsed as SettingsEnvelope).state || typeof (parsed as SettingsEnvelope).state !== "object" ||
      Array.isArray((parsed as SettingsEnvelope).state)) throw new SettingsCorruptError();
  const envelope = parsed as SettingsEnvelope;
  if (envelope.version !== undefined && (typeof envelope.version !== "number" || !Number.isSafeInteger(envelope.version) || envelope.version < 0)) throw new SettingsCorruptError();
  for (const key of ["accounts", "lastSubmitFields"]) {
    const value = envelope.state[key];
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new SettingsCorruptError();
  }
  return { raw, envelope };
}

export async function transactSettings<T>(change: (state: SettingsData) => T): Promise<{ state: SettingsData; result: T }> {
  return withSettingsWriteLock(async () => {
    const { raw, envelope } = await readSettingsEnvelope();
    const before = JSON.stringify(envelope);
    const version = envelope?.version ?? 0;
    const state = envelope ? migrateSettings(envelope.state, version) : { accounts: {}, lastSubmitFields: {}, titlePrefix: "" };
    const beforeState = JSON.stringify(state);
    const result = change(state);
    const next = { ...envelope, state, version: Math.max(version, SETTINGS_STORE_VERSION) };
    if (JSON.stringify(next) !== before && (envelope !== null || JSON.stringify(state) !== beforeState)) {
      await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: typeof raw === "string" || raw == null ? JSON.stringify(next) : next });
    }
    return { state, result };
  });
}

// 형식이 깨진 봉투는 앱이 되살릴 수 없고, 남겨 두면 토큰만 무기한 보관된다 — 같은 잠금 안에서 지운다.
export async function discardCorruptSettingsEnvelope(): Promise<void> {
  await withSettingsWriteLock(async () => {
    // 잠금 대기 중 다른 패널이 이미 지우고 새 봉투를 썼을 수 있다 — 지금도 손상일 때만 지운다.
    try { await readSettingsEnvelope(); return; }
    catch (error) { if (!(error instanceof SettingsCorruptError)) throw error; }
    await chrome.storage.local.remove(SETTINGS_STORAGE_KEY);
  });
}
