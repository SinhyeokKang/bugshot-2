import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

import { escapeHtml } from "../escape-html";

describe("escapeHtml", () => {
  it("4종을 모두 이스케이프한다 (&, <, >, \")", () => {
    expect(escapeHtml('&<>"')).toBe("&amp;&lt;&gt;&quot;");
  });

  // Asana html_notes 경로가 `"`를 빠뜨려 있었다 — 속성 문맥으로 흘러가면 곧 주입이다.
  it("따옴표를 빠뜨리지 않는다", () => {
    expect(escapeHtml('a"b')).toBe("a&quot;b");
  });

  it("& 를 먼저 처리해 이중 이스케이프가 안 난다", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("일반 문자열은 그대로", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
    expect(escapeHtml("")).toBe("");
  });

  // narrowing 결정(overlay 사본의 `'` → `&#39;`를 버린 이유)은 escape-html.ts 헤더에 있다.
  // 여기선 그 결정을 계약으로 못 박아 다음 배치가 같은 계산을 반복하지 않게 한다.
  it("작은따옴표는 이스케이프하지 않는다", () => {
    expect(escapeHtml("it's")).toBe("it's");
  });
});

describe("escapeHtml 단일 출처", () => {
  // 사본이 셋으로 흩어졌던 이력이 있다(그중 하나가 `"`를 빠뜨려 주입 표면이 됐다).
  // `escapeHtml`이라는 이름의 정의 개수만 센다 — 다른 이름의 사본은 못 잡는다.
  it("정의가 저장소 전체에 1곳뿐이다", () => {
    const owners = walkSources(join(process.cwd(), "src"))
      .filter((p) => /function escapeHtml\b|const escapeHtml\s*[:=]/.test(readFileSync(p, "utf8")))
      .map(relToRepo);

    expect(owners).toEqual(["src/lib/escape-html.ts"]);
  });
});
