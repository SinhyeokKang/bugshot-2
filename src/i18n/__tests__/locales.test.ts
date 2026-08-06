import { describe, expect, it } from "vitest";
import ko from "../ko";
import en from "../en";

describe("i18n locale parity", () => {
  it("디바이스 경고는 재로드 경계를 ON·Full 복귀로만 안내한다", () => {
    expect(ko["issue.device.modeWarning.body"]).toBe(
      "디바이스 뷰포트를 켜거나 전체로 되돌릴 때 페이지가 다시 열립니다. 또 원래 페이지가 화면에서만 감춰진 채 계속 실행되므로, 네트워크 요청·자동 저장·결제 같은 동작이 두 번 일어날 수 있습니다. 되돌릴 수 없는 화면에서는 사용하지 마세요.",
    );
    expect(en["issue.device.modeWarning.body"]).toBe(
      "The page reopens when you turn on a device viewport or switch back to Full. The original page also keeps running while hidden, so network requests, autosaves, and payments can happen twice. Don't use this on screens you can't undo.",
    );
  });

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
