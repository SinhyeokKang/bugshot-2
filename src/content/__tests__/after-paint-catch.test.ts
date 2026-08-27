import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ARCHITECTURE.md "캡처 프레임 커밋 대기" 불변식 셋 중 하나 — 응답을 `.then()`으로 미루면
// 메시지 핸들러의 try/catch **밖**이라 삼킨 예외가 사이드패널 await를 영구히 매달거나
// 오버레이 원복을 통째로 거른다. 실패가 무음이라 유닛·e2e 어디에도 안 잡히고, 대상 파일
// (picker·area-select·frame-geometry)은 전부 커버리지 로직 스코프 제외라 배선을 되돌려도
// 유닛은 green이다 — 소스 스캔이 이 규칙의 유일한 그물이다.
// (`await afterPaint()`는 대상이 아니다 — 호출부 try/catch 안이라 규칙이 적용되지 않는다.)
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SrcFile {
  file: string;
  source: string;
}

function readSrcFiles(dir: string, prefix = ""): SrcFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return e.name === "__tests__" || e.name === "node_modules"
        ? []
        : readSrcFiles(join(dir, e.name), `${prefix}${e.name}/`);
    }
    if (!e.name.endsWith(".ts") && !e.name.endsWith(".tsx")) return [];
    return [{ file: `${prefix}${e.name}`, source: readFileSync(join(dir, e.name), "utf8") }];
  });
}

// `(`에서 시작해 짝이 맞는 `)` 다음 인덱스를 돌려준다. 정규식으로 중첩 괄호를 세려다 콜백
// 본문의 `)`에 먼저 걸리는 걸 피하려는 것 — 문자열·주석 안의 괄호는 무시하지 않으므로
// 콜백 안에 짝 안 맞는 괄호 리터럴이 생기면 이 스캐너가 오작동한다(그때 여기를 강화).
function matchParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// 공백뿐 아니라 주석도 건넌다 — 대상 3파일이 전부 `.then()`과 `.catch()` 사이에 "왜 붙였는지"
// 주석을 끼워두고 있어서, 공백만 건너면 규칙을 지킨 코드가 위반으로 잡힌다(오탐).
const skipTrivia = (source: string, i: number): number => {
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source.startsWith("//", i)) {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return source.length;
      i = nl + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i);
      if (end === -1) return source.length;
      i = end + 2;
      continue;
    }
    return i;
  }
};

// afterPaint() 뒤에 `.then(...)`이 붙은 곳만 골라, 그 체인이 `.catch(`로 이어지는지 본다.
function deferredChains(source: string): { hasCatch: boolean; line: number }[] {
  const out: { hasCatch: boolean; line: number }[] = [];
  const CALL = "afterPaint()";
  for (let idx = source.indexOf(CALL); idx !== -1; idx = source.indexOf(CALL, idx + 1)) {
    let i = skipTrivia(source, idx + CALL.length);
    if (!source.startsWith(".then(", i)) continue;
    const end = matchParen(source, i + ".then".length);
    if (end === -1) continue;
    const after = skipTrivia(source, end);
    out.push({
      hasCatch: source.startsWith(".catch(", after),
      line: source.slice(0, idx).split("\n").length,
    });
  }
  return out;
}

const all = readSrcFiles(SRC_DIR);
const chains = all.flatMap((f) =>
  deferredChains(f.source).map((c) => ({ ...c, file: f.file })),
);

describe("afterPaint 지연 응답 .catch() 게이트", () => {
  // 스캐너가 0곳을 훑고도 green이 되는 걸 막는다. 개수 하한이 아니라 파일명을 박아, 체인
  // 탐지가 깨졌을 때 "3→0"이 아니라 "그 파일이 사라졌다"로 red가 뜨게 한다.
  it("스캔이 실제 체인에 도달한다 (자기검증 앵커)", () => {
    expect(chains.length).toBeGreaterThanOrEqual(3);
    const files = chains.map((c) => c.file);
    expect(files).toContain("content/picker.ts");
    expect(files).toContain("content/area-select.ts");
    expect(files).toContain("content/frame-geometry.ts");
  });

  it("afterPaint().then(...)에는 전부 .catch()가 붙는다", () => {
    const missing = chains
      .filter((c) => !c.hasCatch)
      .map((c) => `${c.file}:${c.line}`);
    expect(missing).toEqual([]);
  });

  // 스캐너가 항진명제가 아님을 실증한다 — .catch()를 떼면 실제로 걸린다.
  it("실증: .catch() 없는 체인을 탐지한다", () => {
    const src = `void afterPaint().then(() => send({ ok: true }));`;
    expect(deferredChains(src)).toEqual([{ hasCatch: false, line: 1 }]);
  });

  // await 형태는 호출부 try/catch 안이라 규칙 밖 — 스캐너가 이걸 잡으면 오탐이다.
  it("await afterPaint()는 대상이 아니다", () => {
    expect(deferredChains(`await afterPaint();\ndoWork();`)).toEqual([]);
  });
});
