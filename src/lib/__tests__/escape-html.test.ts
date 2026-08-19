import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

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

  // overlay 사본은 `'` → `&#39;`를 갖고 있었다. 정본으로 합치며 그쪽을 버린다(narrowing):
  // overlay에 단일인용 속성이 0건이고, 반대로 넓히면 정본 소비처 4개(클립보드 text/html·
  // logs.html·Asana html_notes·라이브 프리뷰)의 출력이 모든 아포스트로피에서 바뀌는데
  // 그걸 잡는 그물이 없다. 결정을 여기 못 박아 다음 배치가 같은 계산을 반복하지 않게 한다.
  it("작은따옴표는 이스케이프하지 않는다", () => {
    expect(escapeHtml("it's")).toBe("it's");
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("escapeHtml 단일 출처", () => {
  // 사본이 셋으로 흩어졌던 이력이 있다(그중 하나가 `"`를 빠뜨려 주입 표면이 됐다).
  // 이름 기반 grep은 재발을 못 막으므로 정의 개수를 소스 전수 스캔으로 잠근다.
  it("정의가 저장소 전체에 1곳뿐이다", () => {
    const owners = walk(join(process.cwd(), "src"))
      .filter((p) => /function escapeHtml\b|const escapeHtml\s*[:=]/.test(readFileSync(p, "utf8")))
      .map((p) => p.replace(`${process.cwd()}/`, ""));

    expect(owners).toEqual(["src/lib/escape-html.ts"]);
  });
});
