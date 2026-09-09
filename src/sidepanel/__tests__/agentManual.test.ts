import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkSources, relToRepo } from "@/test/sourceFiles";

// ─────────────────────────────────────────────────────────────────────────────
// 에이전트 조작 매뉴얼 ↔ 실제 UI 대조 스캔
//
// `src/sidepanel/index.html`에 비가시 <script id="__BUGSHOT_AGENT__"> 블록으로 박히는,
// 런타임 에이전트 브라우저(저장소 접근이 없다)용 조작 매뉴얼. logs.html의 AI_LOGS_MANUAL과
// 같은 계열이지만 **읽는 법이 아니라 조작법**이라 가리키는 대상(testid)이 코드와 함께 움직인다.
// 드리프트 표면이 그만큼 넓다.
//
// 그물의 형태가 중요하다. AI_LOGS_MANUAL은 주장을 **문구로** 매칭해서, 매뉴얼이 틀려도
// 자기 자신과는 늘 일치했다(POSTMORTEM 2026-09-09 — 네 주장이 데이터에서 갈렸는데 테스트가
// 하나도 못 잡았다). 그래서 여기서는 매뉴얼이 말하는 셀렉터를 **실제 컴포넌트 소스에
// 바인딩**한다 — testid를 리네임·삭제하면 red다.
//
// 양쪽 목록을 손으로 적지 않는다(2026-09-09 처방 3 "전수 스캔은 목록을 손으로 적지 않는다").
// 매뉴얼 쪽은 본문에서 정규식으로, 소스 쪽은 디렉터리에서 파생하고, 파생이 무너지면 red가
// 되도록 자기검증 앵커를 별 `it`으로 둔다.
//
// **단방향이 의도다.** "매뉴얼이 말한 testid가 소스에 있는가"만 본다. 역방향(소스에 있는데
// 매뉴얼에 없다)은 red가 아니다 — 매뉴얼은 도그푸딩 경로 한 줄기만 다루고 UI 전수가 아니다.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PANEL_HTML = join(REPO_ROOT, "src/sidepanel/index.html");
const PANEL_DIR = join(REPO_ROOT, "src/sidepanel");

const html = readFileSync(PANEL_HTML, "utf8");

// 매뉴얼은 정적 파일 안에 있어야 한다 — 앱을 실행하지 않고 서빙 바이트만 읽는 에이전트도
// 닿아야 하기 때문이다(런타임 주입이면 fetch 경로가 죽는다).
function extractManual(source: string): string | null {
  const m = source.match(
    /<script\b[^>]*\bid="__BUGSHOT_AGENT__"[^>]*>([\s\S]*?)<\/script>/,
  );
  return m ? m[1] : null;
}

// 매뉴얼은 셀렉터를 `[data-testid="..."]` 형태로 적는다 — 에이전트가 그대로 쓸 수 있는 표기이자
// 이 스캔의 추출 앵커다. 백틱 토큰 같은 느슨한 표기를 허용하면 추출이 조용히 0건이 된다.
const MANUAL_TESTID_RE = /\[data-testid="([^"]+)"\]/g;

// 소스 쪽 정의 지점 둘. 대부분은 JSX 속성이지만 일부 합성 컴포넌트는 `testId` prop으로 받는다
// (예: IssueTab의 capture-method-*). 한쪽만 모으면 그 계열이 통째로 빠진다.
const SOURCE_TESTID_RE = /(?:data-testid|testId)="([^"]+)"/g;

function collect(re: RegExp, text: string): string[] {
  return [...text.matchAll(new RegExp(re.source, "g"))].map((m) => m[1]);
}

const manual = extractManual(html);

const sourceTestIds = new Set(
  walkSources(PANEL_DIR).flatMap((f) =>
    collect(SOURCE_TESTID_RE, readFileSync(f, "utf8")),
  ),
);

describe("에이전트 조작 매뉴얼 (__BUGSHOT_AGENT__)", () => {
  it("사이드패널 index.html에 정적으로 박혀 있다", () => {
    expect(manual).not.toBeNull();
    expect(manual?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("type이 text/markdown이다 — 브라우저가 실행하지 않고 에이전트는 평문으로 읽는다", () => {
    const tag = html.match(/<script\b[^>]*\bid="__BUGSHOT_AGENT__"[^>]*>/)?.[0];
    expect(tag).toBeDefined();
    expect(tag).toContain('type="text/markdown"');
  });

  it("리터럴 </script 미포함 — script 태그 조기 종료 방지 (대소문자 무시)", () => {
    expect((manual ?? "").toLowerCase()).not.toContain("</script");
  });

  // ── 자기검증 앵커 2벌 ──────────────────────────────────────────────────────
  // 아래 대조는 양쪽 파생이 살아있을 때만 의미가 있다. 정규식이 망가지거나 표기를 바꾸면
  // 추출이 0건이 되어 대조가 공허하게 통과한다(2026-08-19 "대상이 0건이라 정규식이 망가져도
  // green"). 그 상태를 별 케이스로 red로 만든다.

  it("앵커: 매뉴얼에서 testid 셀렉터가 실제로 추출된다", () => {
    expect(collect(MANUAL_TESTID_RE, manual ?? "").length).toBeGreaterThan(0);
  });

  it("앵커: 소스에서 testid가 실제로 수집된다", () => {
    expect(sourceTestIds.size).toBeGreaterThan(0);
  });

  // ── 본 대조 ───────────────────────────────────────────────────────────────

  it("매뉴얼이 말하는 testid는 전부 사이드패널 소스에 실재한다", () => {
    const referenced = [...new Set(collect(MANUAL_TESTID_RE, manual ?? ""))];
    const missing = referenced.filter((id) => !sourceTestIds.has(id));
    expect(missing).toEqual([]);
  });

  it("매뉴얼이 말하는 패널 URL 쿼리 축(tabId)이 실제 바인딩 코드에 실재한다", () => {
    // 매뉴얼의 부트스트랩 한 줄이 `?tabId=`에 걸려 있다. 이 쿼리 해석을 지우거나 이름을 바꾸면
    // 에이전트는 패널을 엉뚱한 탭에 붙인 채 조용히 진행한다.
    expect(manual).toContain("tabId");
    const boundTabId = readFileSync(
      join(PANEL_DIR, "hooks/useBoundTabId.ts"),
      "utf8",
    );
    expect(boundTabId).toContain('searchParams.get("tabId")');
  });

  it("매뉴얼이 로그 수집의 순서 계약을 말하고, 그 계약의 근거 코드가 실재한다", () => {
    // 레코더 주입이 "패널이 열려 있는 동안"에 묶여 있다는 것이 매뉴얼의 유일한 무음 실패
    // 지점이다(테스트를 끝낸 뒤 패널을 열면 로그가 빈 채로 리포트가 나간다).
    // 문구가 아니라 그 사실의 출처를 함께 고정한다.
    const recorder = readFileSync(
      join(PANEL_DIR, "hooks/useBackgroundRecorder.ts"),
      "utf8",
    );
    expect(recorder).toContain("activateNetworkRecorder");
    expect(recorder).toContain("activateConsoleRecorder");
    expect(recorder).toContain("activateActionRecorder");
    // 매뉴얼이 그 순서를 실제로 지시하는지 — 패널을 먼저 연다는 축.
    expect(/before|first/i.test(manual ?? "")).toBe(true);
  });

  it("에이전트가 넘을 수 없는 축(영상 녹화)을 명시적으로 배제한다", () => {
    // 화면 녹화는 브라우저 네이티브 선택 다이얼로그라 페이지 밖이고, 탭 녹화도 e2e가
    // 자동화 불안정으로 스위트에서 뺐다. 안 적으면 에이전트가 계속 두드린다.
    expect(/video|record/i.test(manual ?? "")).toBe(true);
    const modeRecord = [...sourceTestIds].includes("mode-record");
    expect(modeRecord).toBe(true);
    // 배제 대상이므로 매뉴얼은 그 셀렉터를 조작 대상으로 제시하지 않는다.
    expect(collect(MANUAL_TESTID_RE, manual ?? "")).not.toContain("mode-record");
  });

  it("매뉴얼이 참조하는 소스 파일 경로가 실재한다", () => {
    // 매뉴얼 본문이 아니라 이 테스트가 무는 경로들 — 파일이 옮겨가면 위 케이스가 ENOENT로
    // 죽는 대신 여기서 먼저 이유가 드러난다.
    for (const rel of [
      "src/sidepanel/index.html",
      "src/sidepanel/hooks/useBoundTabId.ts",
      "src/sidepanel/hooks/useBackgroundRecorder.ts",
    ]) {
      expect(() => readFileSync(join(REPO_ROOT, rel), "utf8")).not.toThrow();
    }
    expect(relToRepo(PANEL_HTML)).toBe("src/sidepanel/index.html");
  });
});
