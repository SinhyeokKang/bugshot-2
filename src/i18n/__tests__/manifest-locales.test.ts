import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { walkSources } from "@/test/sourceFiles";
import { readManifestRegistry } from "@/test/manifest-registry";
import { BASE_LOCALE, DEFAULT_LOCALE, LOCALES } from "../locales";
import { findExtraneous, findParityViolations, findUncovered } from "@/test/locale-parity";

// 이 저장소의 세 번째 사전이다. src/i18n(사이드패널)·log-viewer/i18n(복제본)과 달리 TS 밖
// JSON이라 컴파일이 못 보고, locales.test.ts는 src/i18n만 순회하므로 여태 그물이 0이었다.
// 여기 담긴 건 확장 이름·설명·단축키 라벨이고 웹스토어 등록정보로도 나간다 — 로케일을
// 추가하고 이걸 빠뜨리면 그 사용자에게 확장 이름이 기본 로케일로 남는다.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const localesDir = join(repoRoot, "public", "_locales");
const manifestSource = readFileSync(join(repoRoot, "manifest.config.ts"), "utf8");

const registry = readManifestRegistry(localesDir);

// 이 사전의 소비자는 둘이다 — manifest의 __MSG_ 치환과 런타임 chrome.i18n.getMessage.
// manifest만 훑으면 후자로만 쓰이는 키가 "죽은 문자열"로 오탐되고, 더 나쁘게는 런타임에서
// 부르면서 사전에 없는 키를 아무도 못 잡는다(POSTMORTEM 2026-07-26 — 스캔 범위가 실제
// 참조 그래프보다 좁으면 검사 내용이 정교해도 무의미). chrome.i18n은 번들과 무관하게 같은
// 사전을 보므로 import 그래프 BFS까지 갈 것 없이 src/ 전체 텍스트 스캔이면 충분하다.
const manifestKeys = [...manifestSource.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);

const runtimeKeys = walkSources(join(repoRoot, "src")).flatMap((file) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /chrome\.i18n\.getMessage\(\s*["'`](\w+)["'`]/g,
    ),
  ].map((m) => m[1]),
);

const referencedKeys = [...new Set([...manifestKeys, ...runtimeKeys])];

describe("manifest _locales — 커버리지", () => {
  it("등록된 모든 로케일이 messages.json을 갖는다", () => {
    expect(findUncovered(LOCALES, registry)).toEqual([]);
  });

  it("LOCALES에 없는 로케일 디렉터리가 남아있지 않다", () => {
    expect(findExtraneous(LOCALES, registry)).toEqual([]);
  });
});

describe("manifest _locales — 대칭", () => {
  it("기준 로케일 대비 키·값·토큰이 대칭이다", () => {
    expect(findParityViolations(registry, BASE_LOCALE)).toEqual([]);
  });
});

describe("manifest __MSG_ 참조", () => {
  // 정규식이 조용히 0건을 반환하면 아래 대조가 vacuous green이 된다.
  it("추출기가 실제로 참조 키를 찾는다 (자기검증 앵커)", () => {
    expect(manifestKeys).toContain("EXT_NAME");
    expect(manifestKeys.length).toBeGreaterThanOrEqual(4);
  });

  // manifest만 훑으면 런타임 참조를 놓친다 — chrome.i18n.getMessage로 부르고 사전에 안 넣은
  // 키가 무검출로 남고, 반대로 런타임 전용 키가 "죽은 문자열"로 오탐된다.
  // 두 소스를 따로 노출해, manifest를 빼고도 런타임 스캔이 실제로 뭔가를 찾는지 고정한다.
  it("런타임 참조(chrome.i18n.getMessage)도 따로 수집한다 (자기검증 앵커)", () => {
    expect(runtimeKeys.length).toBeGreaterThan(0);
    expect(runtimeKeys).toContain("EXT_NAME_SHORT");
  });

  // 진짜 회귀는 이쪽이다 — 키를 새로 참조하고 사전에 안 넣는 것.
  it("참조되는 키가 모든 로케일 사전에 존재한다", () => {
    const missing = referencedKeys.flatMap((key) =>
      LOCALES.filter((locale) => !(key in (registry[locale] ?? {}))).map(
        (locale) => `${locale} ${key}`,
      ),
    );
    expect(missing).toEqual([]);
  });

  it("사전에만 있고 아무도 안 쓰는 키가 없다 (죽은 문자열)", () => {
    const referenced = new Set(referencedKeys);
    const unused = Object.keys(registry[BASE_LOCALE] ?? {}).filter((k) => !referenced.has(k));
    expect(unused).toEqual([]);
  });
});

// Chrome이 강제하는 길이 상한 — 넘으면 확장 로드 실패 또는 CWS 업로드 거부인데, typecheck와
// 대칭 테스트가 전부 green인 채 스토어에서만 터진다(en EXT_DESCRIPTION이 131자로 여유 1자).
// 신규 로케일마다 재발하는 축이라 자동 가드로 잠근다.
describe("manifest _locales — Chrome 길이 예산", () => {
  it("EXT_DESCRIPTION ≤ 132자 · EXT_NAME ≤ 75자 (전 로케일)", () => {
    const over = Object.entries(registry).flatMap(([locale, dict]) => {
      const out: string[] = [];
      if ((dict.EXT_DESCRIPTION ?? "").length > 132)
        out.push(`${locale} EXT_DESCRIPTION ${dict.EXT_DESCRIPTION.length}`);
      if ((dict.EXT_NAME ?? "").length > 75) out.push(`${locale} EXT_NAME ${dict.EXT_NAME.length}`);
      return out;
    });
    expect(over).toEqual([]);
  });

  // 제품명은 번역 대상이 아니다 — 액션 버튼 라벨이 로케일마다 갈리면 브랜드가 쪼개진다.
  it("EXT_NAME_SHORT는 모든 로케일에서 BugShot이다 (제품명 핀)", () => {
    const wrong = Object.entries(registry)
      .filter(([, dict]) => dict.EXT_NAME_SHORT !== "BugShot")
      .map(([locale]) => locale);
    expect(wrong).toEqual([]);
  });
});

describe("manifest default_locale", () => {
  const declared = manifestSource.match(/default_locale:\s*"([^"]+)"/)?.[1];

  it("선언돼 있고 등록된 로케일이다", () => {
    expect(declared).toBeDefined();
    expect(LOCALES).toContain(declared as (typeof LOCALES)[number]);
  });

  // Chrome이 미지원 로케일에서 떨어뜨리는 곳과 앱 내부 폴백이 갈리면 확장 이름만 다른 언어가 된다.
  it("앱의 DEFAULT_LOCALE과 일치한다", () => {
    expect(declared).toBe(DEFAULT_LOCALE);
  });
});
