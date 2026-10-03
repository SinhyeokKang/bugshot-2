import { vi } from "vitest";

export function mockWebLocks(): void {
  const held = new Set<string>();
  vi.stubGlobal("navigator", {
    userAgent: globalThis.navigator?.userAgent ?? "",
    locks: {
      request: async <T>(name: string, _options: LockOptions, callback: (lock: Lock | null) => T) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try { return await callback({ name, mode: "exclusive" } as Lock); }
        finally { held.delete(name); }
      },
    },
  });
}
