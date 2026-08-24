import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LocaleRegistry } from "./locale-parity";

// public/_locales(세 번째 사전)를 평평한 LocaleRegistry로 읽는 단일 출처. 검사기 두 벌
// (manifest-locales·proper-nouns)이 각자 readdir+JSON.parse를 복제하면 한쪽만 강화된다.
type ChromeMessages = Record<string, { message: string }>;

export function readManifestRegistry(localesDir: string): LocaleRegistry {
  return Object.fromEntries(
    readdirSync(localesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const raw = JSON.parse(
          readFileSync(join(localesDir, e.name, "messages.json"), "utf8"),
        ) as ChromeMessages;
        // 검사기는 평평한 사전을 받는다 — Chrome 포맷의 message만 뽑아 맞춘다.
        return [e.name, Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]))];
      }),
  );
}
