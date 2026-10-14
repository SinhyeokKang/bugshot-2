import { migrateSettings, SETTINGS_STORE_VERSION, type SettingsData } from "./settings-migrations";

export const SETTINGS_STORAGE_KEY = "bugshot-settings";
export const SETTINGS_WRITE_LOCK = "bugshot-settings-write";
export interface SettingsEnvelope { state: SettingsData; version?: number; [key: string]: unknown }
export class SettingsStorageError extends Error {}
export class StaleGrantError extends Error {
  constructor() { super("The connected account changed. Retry with the current account."); }
}

export async function withSettingsWriteLock<T>(run: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) throw new SettingsStorageError("Settings lock unavailable");
  return navigator.locks.request(SETTINGS_WRITE_LOCK, { mode: "exclusive" }, run);
}

export async function readSettingsEnvelope() {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = result[SETTINGS_STORAGE_KEY];
  if (raw == null) return { raw, envelope: null };
  let parsed: unknown;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { throw new SettingsStorageError("Invalid settings envelope"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !(parsed as SettingsEnvelope).state || typeof (parsed as SettingsEnvelope).state !== "object" ||
      Array.isArray((parsed as SettingsEnvelope).state)) throw new SettingsStorageError("Invalid settings envelope");
  const envelope = parsed as SettingsEnvelope;
  if (envelope.version !== undefined && (typeof envelope.version !== "number" || !Number.isSafeInteger(envelope.version) || envelope.version < 0)) throw new SettingsStorageError("Invalid settings version");
  for (const key of ["accounts", "lastSubmitFields"]) {
    const value = envelope.state[key];
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new SettingsStorageError("Invalid settings state");
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
