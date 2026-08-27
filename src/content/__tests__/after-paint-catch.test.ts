import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { relToRepo, walkSources } from "@/test/sourceFiles";

// ARCHITECTURE.md "캡처 프레임 커밋 대기" 불변식 셋 중 하나 — 응답을 `.then()`으로 미루면
// 메시지 핸들러의 try/catch **밖**이라 삼킨 예외가 사이드패널 await를 영구히 매달거나
// 오버레이 원복을 통째로 거른다. 실패가 무음이라 유닛·e2e 어디에도 안 잡히고, 체인 넷 중
// 셋을 든 `picker.ts`·`area-select.ts`가 커버리지 로직 스코프 제외라(`coverage-report.mjs`의
// `BROWSER_BOUND_EXACT`) 배선을 되돌려도 유닛은 green이다 — 소스 스캔이 이 규칙의 유일한 그물.
//
// ⚠ **사정거리는 `.then()` 체인까지다.** `await afterPaint()` 형태는 이 스캔이 안 본다.
// "호출부 try/catch 안이라 안전하다"가 아니다 — 현재 유일한 await 자리(`picker.ts`의
// `respondWithTopRect`)는 호출부가 `void respondWithTopRect(...)`라 async 함수의 rejection이
// 버려지고, 감싸는 try/catch(`handlePickerMessage`)가 원리적으로 못 잡는다. 그 자리의 대기
// 뒷줄 `sendResponse`가 throw하면 규칙이 막으려던 실패가 그대로 난다. 미해결 구멍이고,
// `.then()` 체인과 판정 방식이 달라(호출부까지 역추적해야 한다) 여기 넣지 않았다.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 주석·문자열·정규식 리터럴의 **내용만** 공백으로 덮는다(길이·줄바꿈 보존 → 줄 번호 유지).
// 이걸 안 하면 셋 다 스캐너를 깬다: 주석 안 코드 예시가 위반으로 잡히고, 문자열 속 `)`가
// 괄호 매칭을 조기 종료시키고, 정규식 속 따옴표가 문자열 시작으로 읽힌다.
// 정규식/나눗셈 판정은 직전 유효 문자로 하는 통상 휴리스틱 — 대상 집합이 작아 충분하다.
// `in`·`of`는 뺀다 — 합법 식별자·프로퍼티명이라 `x.in / 2`를 정규식 시작으로 오판하고,
// 그 뒤에 정규식 리터럴이 올 개연성은 사실상 없다.
const KEYWORD_TAIL = /\b(return|typeof|case|do|else|yield|await)\s*$/;

function blankLiterals(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  // 템플릿 안의 `${}` 보간은 실코드라 덮으면 안 되고, 보간이 닫히면 다시 템플릿 텍스트로
  // 돌아가야 한다. 그 복귀를 안 하면 닫는 백틱이 **새 템플릿 시작**으로 읽혀 뒤의 실코드가
  // 통째로 덮인다 — 스택으로 보간 중첩(중첩 템플릿 포함)을 센다.
  const braces: number[] = [];
  let inTemplate = false;
  let prev = "";
  let i = 0;
  const templateText = () => {
    let j = i + 1;
    while (j < source.length) {
      if (source[j] === "\\") j += 2;
      else if (source[j] === "`" || (source[j] === "$" && source[j + 1] === "{")) break;
      else j++;
    }
    blank(i + 1, j);
    if (source[j] === "$") {
      braces.push(0);
      inTemplate = false;
      i = j + 1;
    } else {
      inTemplate = false;
      i = j;
    }
    prev = "`";
  };
  while (i < source.length) {
    if (inTemplate) {
      i -= 1;
      templateText();
      i += 1;
      continue;
    }
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? source.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === "`") {
      templateText();
      i += 1;
      continue;
    }
    if (braces.length > 0) {
      if (c === "{") braces[braces.length - 1] += 1;
      else if (c === "}") {
        if (braces[braces.length - 1] === 0) {
          braces.pop();
          inTemplate = true;
          i += 1;
          continue;
        }
        braces[braces.length - 1] -= 1;
      }
    }
    // 값이 올 수 없는 자리의 `/`는 정규식 시작 — 나눗셈이면 직전이 피연산자다. `>`는 화살표
    // 꼬리이고, `return /re/` 류는 직전이 식별자 문자라 문자 판정만으론 나눗셈으로 샌다.
    if (
      c === "/" &&
      (prev === "" || "(,=:[!&|?{};+-*%~^>".includes(prev) || KEYWORD_TAIL.test(source.slice(0, i)))
    ) {
      let j = i + 1;
      let cls = false;
      while (j < source.length && source[j] !== "\n") {
        const d = source[j];
        if (d === "\\") j += 2;
        else if (d === "[") (cls = true), j++;
        else if (d === "]") (cls = false), j++;
        else if (d === "/" && !cls) break;
        else j++;
      }
      if (source[j] === "/") {
        blank(i + 1, j);
        i = j + 1;
        prev = "/";
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out.join("");
}

// `(`에서 시작해 짝이 맞는 `)` 다음 인덱스. 리터럴이 덮인 소스에서만 부른다.
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

const skipSpace = (source: string, i: number): number => {
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
};

// `.then(onOk, onErr)`의 둘째 인자 유무. **콤마 존재만 보면 안 된다** — 이 저장소는 멀티라인
// 호출에 후행 콤마를 붙이므로(`picker.ts`의 .catch()가 그 포맷) `.then(() =>\n  f(x),\n)`가
// depth-1 콤마를 만들어 rejection 핸들러가 있는 것처럼 읽힌다. 콤마 뒤에 닫는 괄호 말고
// 실제 토큰이 남는지까지 본다.
function hasSecondArg(args: string): boolean {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 1) {
      if (/^\s*[^)\s]/.test(args.slice(i + 1))) return true;
    }
  }
  return false;
}

// afterPaint(...) 뒤의 프라미스 체인을 훑어 rejection이 처리되는지 본다. `.then()`이 하나도
// 없으면(= await 형태 등) 대상이 아니다. `.then(ok, err)`·중간 `.then()`·`.finally()`를 모두
// 넘겨야 규칙을 지킨 코드가 red가 되지 않는다.
function deferredChains(rawSource: string): { hasCatch: boolean; line: number }[] {
  const source = blankLiterals(rawSource);
  const out: { hasCatch: boolean; line: number }[] = [];
  const CALL = /(?<![\w.$])afterPaint\s*\(/g;
  for (const m of source.matchAll(CALL)) {
    const start = m.index!;
    let i = matchParen(source, start + m[0].length - 1);
    if (i === -1) continue;
    let sawThen = false;
    let handled = false;
    for (;;) {
      i = skipSpace(source, i);
      const link = [".then(", ".catch(", ".finally("].find((k) => source.startsWith(k, i));
      if (!link) break;
      const end = matchParen(source, i + link.length - 1);
      if (end === -1) break;
      if (link === ".then(") {
        sawThen = true;
        if (hasSecondArg(source.slice(i + link.length - 1, end))) handled = true;
      } else if (link === ".catch(") {
        handled = true;
      }
      i = end;
    }
    if (!sawThen) continue;
    out.push({ hasCatch: handled, line: source.slice(0, start).split("\n").length });
  }
  return out;
}

const allSources = walkSources(SRC_DIR).map((p) => ({
  file: relToRepo(p),
  source: readFileSync(p, "utf8"),
}));
// 체인 스캔은 afterPaint를 언급하는 파일만 보면 된다 — 언급이 없으면 체인도 없으므로 커버리지
// 손실 0이고, 렉서가 틀렸을 때의 사정거리가 3파일로 줄어든다.
const all = allSources.filter((f) => f.source.includes("afterPaint"));
const chains = all.flatMap((f) =>
  deferredChains(f.source).map((c) => ({ ...c, file: f.file })),
);

describe("afterPaint 지연 응답 .catch() 게이트", () => {
  // 스캔이 0곳을 훑고도 green이 되는 걸 막는다. 개수는 ARCHITECTURE.md가 "넷"이라 적은 값과
  // 맞물려야 하고, 파일명까지 박아 한 파일이 통째로 스캔 밖으로 새는 것도 잡는다.
  it("스캔이 실제 체인에 도달한다 (자기검증 앵커)", () => {
    expect(chains.length).toBeGreaterThanOrEqual(4);
    const files = chains.map((c) => c.file);
    expect(files.filter((f) => f === "src/content/picker.ts")).toHaveLength(2);
    expect(files).toContain("src/content/area-select.ts");
    expect(files).toContain("src/content/frame-geometry.ts");
  });

  // 렉서가 리터럴 경계를 잘못 잡으면 실코드가 통째로 덮여 체인이 **조용히 사라진다**. 스캔
  // 대상 4파일만 재면 이 단언은 거의 공허하다(템플릿 처리를 통째로 되돌려도 그 4개는 균형이
  // 맞는다) — 그래서 **src 전수**를 잰다. 실제로 이 축을 고치기 전엔 3파일이 깨져 있었고,
  // 스캔 집합이 넓어지는 순간 그게 무음 소실이 된다.
  // ⚠ **균형 유지가 정확성을 뜻하진 않는다** — 균형은 맞는데 실코드를 덮는 오판정이 있다
  // (JSX의 `/>`가 정규식 시작으로 읽히는 `.tsx` 3파일. 이 렉서 이전부터 같았다).
  it("리터럴 덮기가 src 전수에서 괄호 균형을 깨지 않는다", () => {
    expect(allSources.length).toBeGreaterThan(300);
    const unbalanced = allSources
      .filter((f) => {
        const t = blankLiterals(f.source);
        const count = (ch: string) => t.split(ch).length - 1;
        return count("(") !== count(")") || count("{") !== count("}");
      })
      .map((f) => f.file);
    expect(unbalanced).toEqual([]);
  });

  it("afterPaint().then(...)에는 전부 rejection 처리가 붙는다", () => {
    const missing = chains
      .filter((c) => !c.hasCatch)
      .map((c) => `${c.file}:${c.line}`);
    expect(missing).toEqual([]);
  });

  // 스캐너가 항진명제가 아님을 실증한다 — .catch()를 떼면 실제로 걸린다.
  it.each([
    ["한 줄", `void afterPaint().then(() => send({ ok: true }));`],
    // 후행 콤마가 붙은 멀티라인은 depth-1 콤마를 만들어 `.then(ok, err)`로 오인되기 쉽다.
    // 이 저장소가 실제로 쓰는 포맷이라(`picker.ts`의 .catch()가 그 모양) 가장 먼저 샌다.
    ["멀티라인 + 후행 콤마", `void afterPaint()
  .then(() =>
    sendResponse(res),
  );`],
    ["멀티라인 + 후행 콤마 + .finally", `void afterPaint()
  .then(() =>
    sendResponse(res),
  )
  .finally(done);`],
  ])("실증: rejection 처리 없는 체인을 탐지한다 — %s", (_label, src) => {
    expect(deferredChains(src)).toEqual([{ hasCatch: false, line: 1 }]);
  });

  // 아래 넷은 "규칙을 지킨 코드가 red가 되지 않는다"(오탐 없음)를 고정한다.
  it.each([
    ["인자 있는 호출", `void afterPaint(300).then(a).catch(e);`],
    ["중간 .then 체인", `void afterPaint().then(a).then(b).catch(e);`],
    ["2인자 .then", `void afterPaint().then(ok, err);`],
    [".finally가 낀 체인", `void afterPaint().then(a).finally(f).catch(e);`],
  ])("오탐 없음 — %s", (_label, src) => {
    expect(deferredChains(src)).toEqual([{ hasCatch: true, line: 1 }]);
  });

  // await 형태는 이 스캔의 사정거리 밖이다(파일 상단 ⚠ 참조 — 안전하다는 뜻이 아니다).
  it("await afterPaint()는 대상이 아니다", () => {
    expect(deferredChains(`await afterPaint();\ndoWork();`)).toEqual([]);
  });

  // 리터럴 덮기가 없으면 셋 다 스캐너를 깬다.
  it.each([
    ["주석 안 코드 예시", `// void afterPaint().then(() => send(r));`, []],
    [
      "문자열 속 닫는 괄호",
      `void afterPaint().then(() => log(":-)")).catch(e);`,
      [{ hasCatch: true, line: 1 }],
    ],
    [
      "정규식 속 따옴표",
      `const re = /["']/;\nvoid afterPaint().then(a).catch(e);`,
      [{ hasCatch: true, line: 2 }],
    ],
    [
      "화살표 뒤 정규식 속 따옴표",
      `const f = (x) => /["]/.test(x);\nvoid afterPaint().then(a);`,
      [{ hasCatch: false, line: 2 }],
    ],
    // 위 케이스는 `>`(화살표 꼬리) 경로를 탄다. 키워드 뒤는 직전이 식별자 문자라 판정 축이
    // 달라서 따로 박는다 — 안 박으면 KEYWORD_TAIL을 통째로 지워도 전부 green이다.
    [
      "return 뒤 정규식 속 따옴표",
      `function f(x) { return /["]/.test(x); }\nvoid afterPaint().then(a);`,
      [{ hasCatch: false, line: 2 }],
    ],
    [
      "블록 주석 안 코드 예시",
      `/* void afterPaint().then(f); */\nvoid afterPaint().then(a).catch(e);`,
      [{ hasCatch: true, line: 2 }],
    ],
    [
      "템플릿 보간 안의 체인은 살아남는다",
      "const s = `x${(() => { void afterPaint().then(f); })()} y`;",
      [{ hasCatch: false, line: 1 }],
    ],
    [
      "보간 뒤 템플릿 텍스트로 복귀한다 (닫는 백틱이 새 템플릿으로 안 읽힌다)",
      "const s = `a${x} b`;\nvoid afterPaint().then(a).catch(e);",
      [{ hasCatch: true, line: 2 }],
    ],
  ])("리터럴 덮기 — %s", (_label, src, expected) => {
    expect(deferredChains(src as string)).toEqual(expected);
  });
});
