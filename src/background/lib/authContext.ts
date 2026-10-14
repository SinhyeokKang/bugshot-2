import { pickRotatedAuth } from "./rotatedAuth";
import { acquireStoredAuth, sameOAuthGrant, OAUTH_TOKEN_FIELDS } from "@/lib/settings-storage";
import type { PlatformId } from "@/types/platform";
import { StaleGrantError } from "@/lib/settings-envelope";

type Auth = { kind: string; grantId?: string; accessToken?: string };
interface Candidate<A> { current: A }
const candidates = new WeakMap<object, Candidate<Auth>>();

export function createAuthCandidate<const A extends Auth>(auth: A): Candidate<A> {
  const context = { current: auth.kind === "oauth" && !auth.grantId ? { ...auth, grantId: crypto.randomUUID() } : auth };
  candidates.set(context.current, context);
  candidates.set(auth, context);
  return context;
}

export async function acquireRequestAuth<A extends Auth>(platform: PlatformId, auth: A): Promise<A> {
  const candidate = candidates.get(auth);
  if (candidate) return candidate.current as A;
  if (platform === "webhook") return auth;
  return acquireStoredAuth(platform, auth);
}

export function createGrantRefresh<A extends Auth>(
  platform: PlatformId,
  remote: (auth: A) => Promise<A>,
  persist: (expected: A, refreshed: A) => Promise<void>,
): (auth: A) => Promise<A> {
  const flights = new Map<string, Promise<A>>();
  return async (requested) => {
    if (requested.kind !== "oauth") return requested;
    const candidate = candidates.get(requested);
    const start = await acquireRequestAuth(platform, requested);
    if (pickRotatedAuth(platform, requested, start)) return start;
    const identity = Object.entries(start).filter(([key]) => !(OAUTH_TOKEN_FIELDS[platform] as readonly string[]).includes(key)).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([candidate ? "candidate" : "stored", platform, identity]);
    const existing = flights.get(key);
    if (existing) {
      const refreshed = await existing;
      if (candidate) {
        candidate.current = refreshed;
        candidates.set(refreshed, candidate);
      }
      return refreshed;
    }
    const flight = (async () => {
      let refreshed: A;
      try { refreshed = await remote(start); }
      catch (error) {
        if (!candidate) await acquireRequestAuth(platform, start);
        throw error;
      }
      if (!sameOAuthGrant(platform, start, refreshed)) throw new StaleGrantError();
      if (candidate) {
        candidate.current = refreshed;
        candidates.set(refreshed, candidate);
      } else await persist(start, refreshed);
      return refreshed;
    })();
    flights.set(key, flight);
    try { return await flight; }
    finally { if (flights.get(key) === flight) flights.delete(key); }
  };
}
