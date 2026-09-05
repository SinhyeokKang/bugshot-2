import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 재현 환경 Page 값의 조립은 `selectPageUrl` 한 곳이어야 한다. 리졸버 유닛 테스트는
// 호출부를 원리적으로 못 본다 — 실제로 그 사각에서 PreviewPanel의 복사 본문 4분기가
// 리졸버를 안 탄 채 통과했다. 열거가 아니라 스캔이라 새 생산자도 걸린다
// (POSTMORTEM 2026-09-04 재발방지 (2): 종착점을 열거로 관리하지 않는다).

// editor-store가 빠지면 저장 레코드 pageUrl의 원천(confirmDraft)이 스캔 밖이 된다 —
// 이번에 고친 생산 지점 넷 중 하나다.
const ROOTS = ["src/sidepanel/tabs", "src/sidepanel/lib", "src/store"];

// `url:`/`pageUrl:` 인자로 target.url을 직접 먹이는 형태. 줄 시작에 앵커하지 않는다 —
// 한 줄짜리 오브젝트 리터럴(`f({ a, pageUrl: target?.url })`)이 통째로 빠져나가고, 실제로
// 그 형태 하나가 "의도 확인"이 아니라 "못 봐서" 통과하고 있었다(POSTMORTEM 2026-08-27
// 계열: 새 소스 스캔이 저장소 자신의 코드 포맷에 false green).
// 키 앞은 `{`·`,`·줄머리만 허용해 `logs.html?pageUrl:`류 문자열 오탐을 막는다.
// 값 앞은 임의 접근자 체인(`store.`·`useEditorStore.getState().`)을 먹는다.
const DIRECT_FEED =
  /(?:^|[{,])[^\S\n]*(?:url|pageUrl):[^\S\n]*[\w.]*(?:\(\))?[\w.]*target\??\.url/;

// 면제는 테스트 파일이 아니라 **그 줄 옆에** 둔다. 목록으로 들고 있으면 장부가 되고,
// 파일 통째 면제는 같은 파일의 진짜 Page 행까지 스캔 밖으로 만든다.
const OPT_OUT = "page-url-scan:";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap(walk);

// 주석 처리된 코드가 "존재한다"로 통과하면 안 된다 — 삭제 뮤테이션이 흔히 주석 처리다.
function codeOnly(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}
// 마커는 그 줄, 또는 바로 위에 붙은 주석 블록 어디든. 사유가 한 줄에 안 들어가는 경우가
// 많고 "윗줄 하나"로 두면 두 줄짜리 주석에서 조용히 안 걸린다.
function isExempt(lines: string[], i: number): boolean {
  if (lines[i].includes(OPT_OUT)) return true;
  for (let j = i - 1; j >= 0; j--) {
    const line = lines[j].trim();
    if (!line.startsWith("//")) return false;
    if (line.includes(OPT_OUT)) return true;
  }
  return false;
}

const offendingLines = (file: string): string[] => {
  const lines = readFileSync(file, "utf8").split("\n");
  return lines.filter((line, i) => DIRECT_FEED.test(line) && !isExempt(lines, i));
};

describe("Page 행 생산자 — selectPageUrl 우회 금지", () => {
  // 스캐너가 실제로 무언가를 잡는다는 것부터 고정한다 — 대상 집합이 비면 전수 스캔은
  // 항진명제다(POSTMORTEM 2026-08-19).
  it("스캐너 자기검증", () => {
    const hits = (src: string) => {
      const lines = src.split("\n");
      return lines.filter((l, i) => DIRECT_FEED.test(l) && !isExempt(lines, i));
    };

    expect(hits('        url: target?.url ?? "",')).toHaveLength(1);
    expect(hits("    pageUrl: target.url,")).toHaveLength(1);
    expect(hits('    url: store.target?.url ?? "",')).toHaveLength(1);
    expect(hits("      pageUrl: selectPageUrl(state),")).toHaveLength(0);
    // 한 줄 리터럴 — 줄 시작 앵커였다면 통째로 빠져나간다.
    expect(hits("  () => f({ captureMode, pageUrl: target?.url }),")).toHaveLength(1);
    // getState() 체인도 먹는다.
    expect(hits("    url: useEditorStore.getState().target?.url ?? \"\",")).toHaveLength(1);
    // 판정용 참조는 인자 키가 아니다.
    expect(hits("  const prevKey = pageKeyOf(state.target?.url);")).toHaveLength(0);
    // 마커는 같은 줄에도, 윗줄에도 둘 수 있다.
    expect(hits('    url: target?.url ?? "", // page-url-scan: 사유')).toHaveLength(0);
    expect(hits('    // page-url-scan: 사유\n    url: target?.url ?? "",')).toHaveLength(0);
    // 여러 줄 주석 블록의 첫 줄에 있어도 걸린다.
    expect(
      hits('    // page-url-scan: 사유\n    // 이어지는 설명\n    url: target?.url ?? "",'),
    ).toHaveLength(0);
    // 주석이 끊기면 면제되지 않는다.
    expect(
      hits('    // page-url-scan: 사유\n    const x = 1;\n    url: target?.url ?? "",'),
    ).toHaveLength(1);
  });

  it("스캔 대상 파일이 비어 있지 않다", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  // 마커가 붙은 줄이 실제로 존재해야 한다 — 전부 사라졌으면 마커 메커니즘 자체가
  // 검증되지 않은 채 green이 된다(면제가 죽으면 스캐너의 그 분기도 죽는다).
  it("면제 마커가 살아 있다", () => {
    const marked = FILES.filter((f) => readFileSync(f, "utf8").includes(OPT_OUT));
    expect(marked.length).toBeGreaterThan(0);
  });

  it.each(FILES)("%s", (file) => {
    expect(offendingLines(file)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  화면 Page 행 — `value:` 키라 위 스캔이 원리적으로 못 본다             */
/* ------------------------------------------------------------------ */

// 위 규칙은 `url:`/`pageUrl:` 키만 본다. 정작 사용자가 "굳었다"고 보는 건 화면의
// `{ label: "Page", value: ... }` 행이고, 그 값을 `target?.url`로 되돌려도 전 스위트가
// green이었다(뮤테이션 실측). 정규식에 `value:`를 넣으면 오탐이 쏟아지므로, 대신
// `label: "Page"`를 앵커로 삼는다 — 그 라벨을 든 행은 정의상 재현 환경 Page 행이다.
const PAGE_ROW = /label:\s*"Page"/;

describe('label: "Page" 행 — target 직참조 금지', () => {
  const rowsIn = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => PAGE_ROW.test(line));

  it("스캐너 자기검증", () => {
    const bad = (l: string) => PAGE_ROW.test(l) && /\btarget\b/.test(l);
    expect(bad('    { label: "Page", value: target?.url || "-" },')).toBe(true);
    expect(bad('    { label: "Page", value: pageUrl || "-" },')).toBe(false);
    // 인자·레코드 경유는 통과해야 한다(그쪽이 이미 리졸버를 탄 값이다).
    expect(bad('  rows.push({ label: "Page", value: input.url || "-" });')).toBe(false);
    expect(bad('    { label: "Page", value: issue.pageUrl || "-" },')).toBe(false);
  });

  // 생산자가 사라지면 이 describe가 항진명제가 된다.
  it("Page 행 생산자가 실재한다", () => {
    const producers = FILES.filter((f) => rowsIn(f).length > 0);
    expect(producers.length).toBeGreaterThanOrEqual(2);
  });

  it.each(FILES)("%s", (file) => {
    for (const line of rowsIn(file)) expect(line).not.toMatch(/\btarget\b/);
  });
});

/* ------------------------------------------------------------------ */
/*  제출 funnel — 저장 레코드를 실제 제출값으로 정정한다                  */
/* ------------------------------------------------------------------ */

// confirmDraft가 확정 시점 URL로 레코드를 동결하는데 그 뒤 탭이 이동할 수 있다. 정정을
// 지우면 목록·검색·상세가 본문과 다른 페이지를 가리키는데, 뮤테이션 실측 결과 전 스위트가
// green이었다.
//
// **이 그물은 위 둘보다 약하다** — 행동이 아니라 구조만 본다. IssueCreateModal.test.tsx가
// SubmitFieldsDialog를 통째로 모킹해 실제 제출이 안 돌고, 8개 플랫폼 어댑터를 전부 모킹해
// 제출을 구동하는 비용이 이 한 줄의 가치를 넘는다. 정정 위치가 바뀌면(예: store 액션으로
// 이동) 이 테스트를 고치는 게 아니라 그 지점의 행동 테스트로 승격하는 게 맞다.
describe("제출 funnel — 레코드 pageUrl 정정", () => {
  const SRC = codeOnly("src/sidepanel/tabs/IssueCreateModal.tsx");

  it("handleSubmit이 ctx를 만든 뒤 레코드를 같은 값으로 맞춘다", () => {
    const body = SRC.slice(SRC.indexOf("async function handleSubmit"));
    const ctxAt = body.indexOf("buildCtx()");
    const patchAt = body.indexOf("pageUrl: ctx.url");
    expect(ctxAt).toBeGreaterThanOrEqual(0);
    expect(patchAt).toBeGreaterThan(ctxAt);
    // 첫 await보다 앞이어야 한다 — 뒤로 밀면 await 구간의 이동이 레코드에 섞인다.
    expect(patchAt).toBeLessThan(body.indexOf("await "));
  });
});

/* ------------------------------------------------------------------ */
/*  App 배선 — 훅이 읽은 url이 store로 흘러가는 유일한 링크              */
/* ------------------------------------------------------------------ */

// `useLivePageUrl` 본문은 자기 테스트가 잠근다. 잠기지 않는 건 **App이 그 훅을 부르는가**다
// — 그 한 줄을 지워도 전 스위트가 green이었다(뮤테이션 실측). App은 렌더 하네스가 없고
// (chrome API·훅 10여 개 의존) 이 한 줄 때문에 만들 가치는 없다고 판단해 구조로 잠근다.
// 위 제출 funnel 항목과 같은 급의 약한 그물이다 — App 렌더 테스트가 생기면 승격 대상.
describe("App — livePageUrl 발행 배선", () => {
  const SRC = codeOnly("src/sidepanel/App.tsx");

  it("주석 처리된 호출은 존재로 안 친다", () => {
    expect(codeOnly("src/sidepanel/App.tsx")).not.toContain("// useLivePageUrl");
  });

  it("useBoundTabState가 돌려준 url을 그대로 useLivePageUrl에 넘긴다", () => {
    const bound = /useBoundTabState\([^)]*\)/.exec(SRC);
    expect(bound).not.toBeNull();
    // 구조분해에서 url이 받는 지역 이름을 뽑아, 그 이름이 발행 훅 인자와 같은지 본다.
    const alias = /url:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*useBoundTabState/.exec(SRC);
    expect(alias).not.toBeNull();
    expect(SRC).toContain(`useLivePageUrl(${alias![1]})`);
  });
});

