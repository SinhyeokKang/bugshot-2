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
