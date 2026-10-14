import type { Accounts, PlatformId, LastSubmitFieldsByPlatform } from "@/types/platform";
import type { SettingsData } from "./settings-migrations";
import { ACCOUNT_IDENTITY_FIELDS, accountIdentityExcluded, sameAuthIdentity, sameOAuthGrant } from "./settings-storage";

type Auth = NonNullable<Accounts[PlatformId]>["auth"];
export type SettingsIntent =
  | { kind: "connect"; platform: PlatformId; account: Accounts[PlatformId] }
  | { kind: "disconnect"; platform: PlatformId }
  | { kind: "disconnectAll" }
  | { kind: "accountPatch"; platform: PlatformId; expected?: Auth; patch: object }
  | { kind: "prefill"; platform: PlatformId; expected?: Auth; fields: LastSubmitFieldsByPlatform[PlatformId] }
  | { kind: "settings"; patch: { titlePrefix?: string; lastSubmittedPlatform?: PlatformId } };

export function applySettingsIntent(input: { accounts: Accounts; lastSubmitFields: LastSubmitFieldsByPlatform; titlePrefix: string }, intent: SettingsIntent): SettingsData {
  const state = { ...input, accounts: { ...input.accounts }, lastSubmitFields: { ...input.lastSubmitFields } };
  if (intent.kind === "settings") return { ...state, ...intent.patch };
  if (intent.kind === "disconnectAll") return { ...state, accounts: {}, lastSubmitFields: {} };
  const p = intent.platform;
  const current = state.accounts[p];
  if (intent.kind === "disconnect") {
    delete state.accounts[p]; delete state.lastSubmitFields[p];
  } else if (intent.kind === "connect") {
    const next = intent.account;
    const same = current && next && sameAuthIdentity(next.auth as unknown as Record<string, unknown>, current.auth as unknown as Record<string, unknown>, accountIdentityExcluded(p)) &&
      ACCOUNT_IDENTITY_FIELDS[p].every((key) => (next as unknown as Record<string, unknown>)[key] === (current as unknown as Record<string, unknown>)[key]);
    if (!same) delete state.lastSubmitFields[p];
    Object.assign(state.accounts, { [p]: next });
  } else if (current && intent.expected && sameOAuthGrant(p, intent.expected, current.auth)) {
    if (intent.kind === "accountPatch") Object.assign(state.accounts, { [p]: { ...current, ...intent.patch } });
    else Object.assign(state.lastSubmitFields, { [p]: intent.fields });
  }
  return state;
}
