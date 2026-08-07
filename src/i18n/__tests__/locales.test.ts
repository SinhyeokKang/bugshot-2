import { describe, expect, it } from "vitest";
import ko from "../ko";
import en from "../en";

describe("i18n locale parity", () => {
  it("en has every key ko defines", () => {
    const koKeys = Object.keys(ko);
    const enKeys = new Set(Object.keys(en));
    const missing = koKeys.filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("ko has every key en defines", () => {
    const enKeys = Object.keys(en);
    const koKeys = new Set(Object.keys(ko));
    const missing = enKeys.filter((k) => !koKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("no empty values", () => {
    const koEmpty = Object.entries(ko)
      .filter(([_, v]) => !v || !String(v).trim())
      .map(([k]) => k);
    const enEmpty = Object.entries(en)
      .filter(([_, v]) => !v || !String(v).trim())
      .map(([k]) => k);
    expect(koEmpty).toEqual([]);
    expect(enEmpty).toEqual([]);
  });

  it("placeholder tokens 같은 키에서 동일 — {x} 갯수/이름 매칭", () => {
    function tokens(s: string): string[] {
      return [...s.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)]
        .map((m) => m[1])
        .sort();
    }
    const mismatches: string[] = [];
    for (const k of Object.keys(ko)) {
      const koTokens = tokens(ko[k as keyof typeof ko] ?? "");
      const enTokens = tokens(en[k as keyof typeof en] ?? "");
      if (JSON.stringify(koTokens) !== JSON.stringify(enTokens)) {
        mismatches.push(`${k}: ko=[${koTokens.join(",")}] en=[${enTokens.join(",")}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
