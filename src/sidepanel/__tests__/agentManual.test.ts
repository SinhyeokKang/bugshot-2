import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkSources } from "@/test/sourceFiles";
import { supportsActionLog, supportsConsoleNetworkLog } from "../lib/captureLogSupport";

// ─────────────────────────────────────────────────────────────────────────────
// 에이전트 조작 매뉴얼 ↔ 실제 UI 대조 스캔
//
// `src/sidepanel/index.html`에 비가시 <script id="__BUGSHOT_AGENT__"> 블록으로 박히는,
// 런타임 에이전트 브라우저(저장소 접근이 없다)용 조작 매뉴얼. logs.html의 AI_LOGS_MANUAL과
// 같은 계열이지만 **읽는 법이 아니라 조작법**이라 가리키는 대상이 코드와 함께 움직인다.
//
// 그물의 형태가 중요하다. AI_LOGS_MANUAL은 주장을 **문구로** 매칭해서, 매뉴얼이 틀려도
// 자기 자신과는 늘 일치했다(POSTMORTEM 2026-09-09). 그래서 여기서는 매뉴얼의 각 주장을
// **그 주장이 참인 이유가 되는 소스**에 바인딩한다 — 게이트를 뒤집으면 red다.
//
// 이 파일의 케이스는 전부 뮤테이션으로 실측했다(구현을 되돌려 red를 눈으로 봄).
// 실측 없이 짠 첫 판본은 축 여섯이 공허했다:
//   · 문구 정규식을 매뉴얼 전체에 걸어 다른 문단의 같은 단어가 대신 매치
//   · 섹션 파서가 `m` 플래그 lookahead 탓에 **모든 섹션을 빈 문자열**로 반환
//   · 단어 **존재**만 봐서 "먼저 열어라"를 "나중에 열어라"로 뒤집어도 통과
//   · 이름만 매칭해 import 문이 **호출** 대신 매치
//   · 주석 처리된 testid가 "실재한다"로 통과
//   · testid 존재만 봐서 두 버튼의 testid를 맞바꿔도 통과(매핑 축 부재)
// 새 케이스를 추가하면 반드시 같은 실측을 한다.
//
// **단방향이 의도다.** "매뉴얼이 말한 것이 소스에서 참인가"만 본다. 역방향(소스에 있는데
// 매뉴얼에 없다)은 red가 아니다 — 매뉴얼은 도그푸딩 경로 한 줄기만 다루고 UI 전수가 아니다.
// 예외는 영상 축으로, 거기선 "제시하지 않았는가"를 파생 목록으로 강제한다.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PANEL_DIR = join(REPO_ROOT, "src/sidepanel");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

// 주석 처리된 코드가 "존재한다"로 통과하면 안 된다 — 삭제 뮤테이션이 흔히 주석 처리다.
// `pageUrl-callsites.test.ts:codeOnly`와 같은 처방(거기선 파일 경로를 받는다).
const codeOnly = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const html = read("src/sidepanel/index.html");

// 매뉴얼은 정적 파일 안에 있어야 한다 — 앱을 실행하지 않고 서빙 바이트만 읽는 에이전트도
// 닿아야 하기 때문이다(런타임 주입이면 fetch 경로가 죽는다).
const manual =
  html.match(
    /<script\b[^>]*\bid="__BUGSHOT_AGENT__"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1] ?? "";

// 매뉴얼은 셀렉터를 `[data-testid="..."]` 형태로 적는다 — 에이전트가 그대로 쓸 수 있는 표기이자
// 이 스캔의 추출 앵커다. 백틱 토큰 같은 느슨한 표기를 허용하면 추출이 조용히 0건이 된다.
const MANUAL_TESTID_RE = /\[data-testid="([^"]+)"\]/g;

// 소스 쪽 정의 지점 둘. 대부분은 JSX 속성이지만 일부 합성 컴포넌트는 `testId` prop으로 받는다
// (예: IssueTab의 capture-method-*). 한쪽만 모으면 그 계열이 통째로 빠진다.
const SOURCE_TESTID_RE = /(?:data-testid|testId)="([^"]+)"/g;

const collect = (re: RegExp, text: string): string[] =>
  [...text.matchAll(new RegExp(re.source, "g"))].map((m) => m[1]);

// JSX **여는 태그**만 잘라낸다. testid도 핸들러도 속성이라 자식은 볼 필요가 없고, 자식까지
// 무는 `<Button[\s\S]*?</Button>`은 두 방향으로 틀렸다 — `<ButtonGroup`에서 시작해 첫
// `</Button>`이 우연히 자식을 닫는 걸로 이미 통과 중이었고(회고 2026-08-27 ③과 같은 상태),
// self-closing 버튼으로 리팩터하면 블록이 다음 버튼을 삼켜 **동작 무변경인데 red**가 났다.
// `(?=[\s/>])`가 Button과 ButtonGroup을 가르고, 중괄호 깊이가 `onClick={() => …}`의 `>`를
// 태그 끝으로 오인하지 않게 한다.
function openingTags(src: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      // 속성값 안의 `>`를 태그 끝으로 읽으면 그 뒤 속성이 통째로 안 보인다 — Tailwind 임의
      // 셀렉터(`[&>svg]:size-4`)가 저장소에 14곳 있어 IssueTab에 한 줄 들어오는 순간
      // testid 뒤의 onClick이 사라지고 "핸들러 없음"으로 green이 난다(실측).
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

// 버튼 testid → 그 여는 태그에 등장하는 핸들러들. `onClick={식별자}` 리터럴로 판정하면
// `onClick={() => onArea()}`를 "핸들러 없음"으로 읽고(false green), 반대로 동작이 같은
// 화살표 래핑에 red를 낸다(false red). 등장 여부로 보면 두 형태가 같게 판정된다.
function buttonWiring(
  src: string,
  tags: string[],
  idPrefix: RegExp,
  handlers: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tag of tags) {
    for (const open of openingTags(src, tag)) {
      const id = open.match(/(?:data-testid|testId)="([^"]+)"/)?.[1];
      if (!id || !idPrefix.test(id)) continue;
      map.set(
        id,
        handlers.filter((h) => new RegExp(`\\b${h}\\b`).test(open)),
      );
    }
  }
  return map;
}

// 라인 파싱인 게 의도다. 첫 판본은 lazy 캡처 + `(?=^## |\s*$)` lookahead였는데, `m` 플래그에서
// `$`가 줄 끝이라 헤딩 다음 줄에서 즉시 닫혀 **모든 섹션이 빈 문자열**로 나왔다. 그 상태로도
// testid 대조는 전부 green이라, 실측 없이 넘겼으면 문구 축이 통째로 죽은 채 남았다
// (POSTMORTEM 2026-09-06 (5) — 스캔은 만들자마자 잡아야 할 형태를 손으로 먹여본다).
function section(heading: string): string {
  const lines = manual.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${heading}`));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

// 매뉴얼은 하드랩이라 다단어 구문이 수시로 줄바꿈에 갈린다 — 문구 정규식을 raw 섹션에
// 걸면 문장을 안 건드린 리랩만으로 red가 난다(실측: "so fill\none row per step"). 다단어
// 판정은 전부 이걸 거친다. 표처럼 행 구조가 의미를 갖는 판정만 raw `section()`을 쓴다.
const prose = (heading: string): string =>
  section(heading).replace(/\s+/g, " ");

const manualTestIds = collect(MANUAL_TESTID_RE, manual);
const sourceTestIds = new Set(
  walkSources(PANEL_DIR).flatMap((f) =>
    collect(SOURCE_TESTID_RE, codeOnly(readFileSync(f, "utf8"))),
  ),
);

describe("에이전트 조작 매뉴얼 (__BUGSHOT_AGENT__)", () => {
  describe("전달 형태", () => {
    it("사이드패널 index.html에 정적으로 박혀 있다", () => {
      expect(manual.trim().length).toBeGreaterThan(0);
    });

    it("type이 text/markdown이다 — 브라우저가 실행하지 않고 에이전트는 평문으로 읽는다", () => {
      const tag = html.match(/<script\b[^>]*\bid="__BUGSHOT_AGENT__"[^>]*>/)?.[0];
      expect(tag).toContain('type="text/markdown"');
    });

    it("리터럴 </script 미포함 — script 태그 조기 종료 방지 (대소문자 무시)", () => {
      // `manual`은 첫 `</script>` 앞까지만 잘라낸 문자열이라, 거기서 판정하면 위반 상태가
      // **정의상 만들어지지 않는다** — 매뉴얼 꼬리에 리터럴을 넣어도 전 케이스 green이었다.
      // 그래서 원본 html의 여는 태그~`</head>` 구간에서 등장 횟수를 센다.
      const start = html.indexOf('id="__BUGSHOT_AGENT__"');
      const region = html.slice(start, html.indexOf("</head>")).toLowerCase();
      expect(start).toBeGreaterThan(-1);
      expect(region.split("</script").length - 1).toBe(1);
    });

    // 섹션 하나를 통째로 지워도 다른 섹션의 testid가 앵커를 만족해 green이 났다(실측).
    // 필수 섹션 집합을 명시해 매뉴얼의 절반이 조용히 사라지는 걸 막는다.
    it("필수 섹션이 전부 있다 — 절반이 사라져도 testid 대조는 통과한다", () => {
      for (const heading of [
        "Order contract",
        "Choosing a capture",
        "Before you trigger a capture",
        "Writing the report",
      ]) {
        expect(section(heading).length).toBeGreaterThan(0);
      }
    });
  });

  describe("자기검증 앵커", () => {
    // 아래 대조는 양쪽 파생이 살아있을 때만 의미가 있다. 정규식이 망가지거나 표기를 바꾸면
    // 추출이 0건이 되어 대조가 공허하게 통과한다(2026-08-19 "대상이 0건이라 정규식이
    // 망가져도 green").
    it("매뉴얼에서 testid 셀렉터가 실제로 추출된다", () => {
      expect(manualTestIds.length).toBeGreaterThan(0);
    });

    it("소스에서 testid가 실제로 수집된다", () => {
      expect(sourceTestIds.size).toBeGreaterThan(0);
    });
  });

  describe("셀렉터", () => {
    it("매뉴얼이 말하는 testid는 전부 사이드패널 소스에 실재한다", () => {
      const missing = [...new Set(manualTestIds)].filter(
        (id) => !sourceTestIds.has(id),
      );
      expect(missing).toEqual([]);
    });

    // 존재 대조만으로는 두 버튼의 testid를 **맞바꿔도** green이다(실측). 매뉴얼의 유일한
    // 가치가 "무엇을 찾았나 → 어느 버튼"이므로 그 짝을 직접 잰다.
    it("캡처 방식 버튼이 매뉴얼이 말한 동작에 실제로 배선돼 있다", () => {
      const wiring = buttonWiring(
        codeOnly(read("src/sidepanel/tabs/IssueTab.tsx")),
        ["TooltipIconButton"],
        /^capture-method-/,
        ["onViewport", "onFullPage"],
      );
      expect(wiring.get("capture-method-viewport")).toEqual(["onViewport"]);
      expect(wiring.get("capture-method-fullpage")).toEqual(["onFullPage"]);
      // 매뉴얼이 "누르면 아무 일도 안 한다"고 적은 근거 — 이 버튼만 핸들러가 없다.
      expect(wiring.get("capture-method-area")).toEqual([]);
    });

    // 위 케이스를 `capture-method-*` 셋에만 걸어두고 표의 나머지 네 행(진입 모드)은 존재
    // 대조만 태웠다 — 매뉴얼에서 mode-element와 mode-freeform을 맞바꿔도 전부 green이었다.
    // "매핑을 잰다"고 써놓고 3/7만 분류한 형태(2026-09-09 ② — 세는 것과 분류하는 것의 혼동).
    it("진입 모드 버튼이 매뉴얼이 말한 동작에 실제로 배선돼 있다", () => {
      const wiring = buttonWiring(
        codeOnly(read("src/sidepanel/tabs/IssueTab.tsx")),
        ["Button"],
        /^mode-/,
        [
          "onStartElement",
          "onStartElementShot",
          "onStartScreenshot",
          "onStartFreeform",
        ],
      );
      expect(wiring.get("mode-element")).toEqual(["onStartElement"]);
      expect(wiring.get("mode-element-shot")).toEqual(["onStartElementShot"]);
      expect(wiring.get("mode-screenshot")).toEqual(["onStartScreenshot"]);
      expect(wiring.get("mode-freeform")).toEqual(["onStartFreeform"]);
    });
  });

  describe("순서 계약", () => {
    it("로그 수집을 패널 열림에 묶는 근거 코드가 실재한다", () => {
      // `(`까지 붙여 **호출**을 본다. 이름만 보면 import 문이 대신 매치돼, 호출을 통째로
      // 지워도 green이다(실측 — 2026-09-06 (5)의 "주석 처리된 호출을 존재한다로 통과" 계열).
      const recorder = codeOnly(read("src/sidepanel/hooks/useBackgroundRecorder.ts"));
      for (const fn of [
        "activateNetworkRecorder(",
        "activateConsoleRecorder(",
        "activateActionRecorder(",
      ]) {
        expect(recorder).toContain(fn);
      }
      // 매뉴얼의 "제3의 탭으로 가지 마라"를 만드는 건 activate*가 아니라 이 둘이다. 이걸
      // 안 걸면 셋을 다 지워도 activate*가 남아 green이고, 그 지시가 근거 없는 미신이 된다.
      // `addEventListener(`까지 붙인다 — 문자열만 보면 정리 경로의 removeEventListener가
      // 대신 매치돼, 등록을 지워도 green이다(실측).
      expect(recorder).toContain('addEventListener("visibilitychange"');
      expect(codeOnly(read("src/background/tab-bindings.ts"))).toContain(
        "stopRecorders(prevTabId)",
      );
    });

    it("죽은 레코더의 복구 경로로 리로드를 지시한다", () => {
      // 재주입 트리거는 넷이다 — 마운트 / `tabs.onUpdated` status complete / visibilitychange
      // / store 구독의 idle 복귀. visibilitychange는 그 위 주석대로 "같은 탭으로 복귀해 패널
      // 문서가 살아 있는" 배치 전용이라 별도 윈도우에선 안 뛰고, idle 복귀는 사용자가 캡처를
      // 버려야 도달한다. 첫 판본은 "패널을 다시 보이게 하면 된다"는 **실행 불가능한** 복구법을
      // 줬고, 탭 포커스만으로 남는 트리거는 페이지 로드 완료뿐이다.
      expect(codeOnly(read("src/sidepanel/hooks/useBackgroundRecorder.ts"))).toContain(
        'status === "complete"',
      );
      // `/reload/i` 존재만 보면 pre-arm 문단의 "after a reload"가 대신 매치돼 첫 판본의
      // 틀린 복구법이 그대로 통과했다(실측 — 이 파일이 이미 네 번 밟은 형태). 지시구를
      // 요구하고 틀린 서술을 금지해야 방향이 재진다.
      const order = prose("Order contract");
      expect(/reload the (target )?page/i.test(order)).toBe(true);
      expect(/visible again/i.test(order)).toBe(false);
    });

    it("버퍼 소급 flush 상한이 매뉴얼이 말한 '1분'과 일치한다", () => {
      // `PREARM_GRACE_MS`는 레코더 3벌에 **복제**돼 있다(CLAUDE.md: "값을 바꾸려면 3곳").
      // 매뉴얼의 "로그가 비지 않았다고 순서를 맞게 지킨 건 아니다"의 유일한 근거라 값이
      // 갈리면 거짓이 된다. 세 파일을 전부 본다 — 하나만 보면 나머지 둘의 드리프트를 놓친다.
      for (const kind of ["action", "console", "network"]) {
        expect(codeOnly(read(`src/content/${kind}-recorder.ts`))).toContain(
          "PREARM_GRACE_MS = 60000",
        );
      }
      expect(/a minute/i.test(prose("Order contract"))).toBe(true);
    });

    // 단어 **존재**만 보면 "Open it BEFORE you start"를 "Open it AFTER you finish"로
    // 뒤집어도 green이었다(실측 — `before that` 같은 꼬리가 대신 매치). 방향을 재려면
    // 지시구를 통째로 요구하고 역방향 지시를 금지해야 한다.
    it("패널을 먼저 열라고 지시한다 — 역전된 지시가 아니라", () => {
      const order = prose("Order contract");
      expect(/open the panel before/i.test(order)).toBe(true);
      expect(/open (it|the panel) after/i.test(order)).toBe(false);
    });

    it("무음 실패임을 말한다 — 늦게 열면 제출은 되고 증거만 빈다", () => {
      expect(/silent/i.test(prose("Order contract"))).toBe(true);
    });

    it("패널 URL 쿼리 축(tabId)을 그 섹션 안에서 말하고, 해석 코드가 실재한다", () => {
      // 매뉴얼 전체에 걸면 `chrome.windows.create({ tabId })`가 대신 매치돼, URL 문단을
      // 통째로 지워도 green이었다(실측). 섹션으로 좁힌다.
      expect(section("Order contract")).toContain("?tabId=");
      expect(codeOnly(read("src/sidepanel/hooks/useBoundTabId.ts"))).toContain(
        'searchParams.get("tabId")',
      );
    });
  });

  describe("캡처 선택", () => {
    // 소스 쪽 배선(위 두 케이스)을 잠가도 **매뉴얼 표가 어느 행에 어느 셀렉터를 쓰는지**는
    // 여전히 안 재진다 — 표에서 mode-element와 mode-freeform을 맞바꿔도 전부 green이었다
    // (실측). 그러면 스타일 버그를 찾은 에이전트가 캡처 없이 freeform으로 들어간다.
    // 기대 매핑은 손으로 적는다: 표의 의미는 소스에서 파생될 수 있는 게 아니라 우리가 정한
    // 것이고, 그게 바뀌면 red가 나야 맞다. 파생은 "행이 실제로 파싱됐는가" 쪽에 건다.
    it("표의 각 행이 그 상황에 맞는 셀렉터를 가리킨다", () => {
      const rows = section("Choosing a capture")
        .split("\n")
        .filter((l) => l.startsWith("|") && !/^\|\s*-+/.test(l))
        .slice(1); // 헤더 제외
      expect(rows.length).toBe(6); // 파생 앵커 — 표가 줄면 red

      const find = (re: RegExp): string[] => {
        const row = rows.find((r) => re.test(r));
        expect(row, `표에 ${re} 행이 없다`).toBeDefined();
        return collect(MANUAL_TESTID_RE, row ?? "");
      };
      expect(find(/wrong style/i)).toEqual(["mode-element"]);
      expect(find(/element looks wrong/i)).toEqual(["mode-element-shot"]);
      expect(find(/visible right now/i)).toEqual([
        "mode-screenshot",
        "capture-method-viewport",
      ]);
      expect(find(/whole scrolled page/i)).toEqual([
        "mode-screenshot",
        "capture-method-fullpage",
      ]);
      expect(find(/one region/i)).toEqual([
        "mode-screenshot",
        "capture-method-area",
      ]);
      expect(find(/nothing worth showing/i)).toEqual(["mode-freeform"]);
    });

    it("element 모드가 로그를 안 싣는다는 예외를 말한다", () => {
      // 매뉴얼이 헤드라인으로 세운 순서 계약을 완벽히 지켜도 이 모드를 고르면 로그가 0건인
      // 채 정상 제출된다 — 매뉴얼이 막겠다고 한 바로 그 실패 모드다. 매트릭스를 직접 호출해
      // 고정한다(게이트가 element를 포함하도록 바뀌면 이 경고가 거짓이 되고 red).
      expect(supportsConsoleNetworkLog("element")).toBe(false);
      expect(supportsActionLog("element")).toBe(false);
      expect(supportsConsoleNetworkLog("screenshot")).toBe(true);

      expect(/element mode collects no/i.test(prose("Choosing a capture"))).toBe(true);
    });

    it("영상 축을 금지 지시로 배제한다", () => {
      // 재려는 건 "영상을 언급한다"가 아니라 **하지 말라고 지시한다**이다. 언급만 보면 같은
      // 섹션의 설명문("tab recording is too unstable")이 대신 매치돼 금지 문장을 지워도
      // green이다(실측).
      expect(
        /\b(do not|don't|never)\b[^.]*\b(video|record)/i.test(prose("Choosing a capture")),
      ).toBe(true);
    });

    it("영상·리플레이 계열 셀렉터를 조작 대상으로 제시하지 않는다", () => {
      // 배제 목록을 손으로 적으면 `mode-record` 하나만 막고 `replay-*`·`recording-*`는
      // 샌다(2026-09-09 처방 3). 소스에서 파생해 계열 전체를 막는다.
      const banned = [...sourceTestIds].filter((id) =>
        /^(mode-record$|recording-|replay-)/.test(id),
      );
      expect(banned.length).toBeGreaterThan(0); // 파생이 무너지면 red
      expect(manualTestIds.filter((id) => banned.includes(id))).toEqual([]);
    });
  });

  describe("캡처 게이트", () => {
    it("대상 탭이 활성이어야 한다는 주장의 근거가 실재한다", () => {
      // 이 줄을 지우면 매뉴얼의 popup 창 조언이 근거 없는 미신이 되는데, 바인딩이 없으면
      // red가 안 난다.
      const throttle = codeOnly(read("src/background/capture-throttle.ts"));
      expect(throttle).toContain("if (!tab.active)");
      expect(prose("Before you trigger a capture")).toMatch(/active/i);
    });

    // `tab.active`는 **윈도우별**이라, 매뉴얼이 지시한 별도 윈도우 배치에선 패널이 포커스를
    // 가져도 대상 탭은 자기 윈도우의 active로 남아 게이트를 통과한다. 첫 판본은 그걸 모른 채
    // "포그라운드 패널이면 캡처가 실패한다"고 단정해 **자기 조언과 모순**됐다(출처는
    // e2e/GOTCHAS.md와 POSTMORTEM 2026-07-26인데, 둘 다 "사이드패널을 탭으로 여는"
    // e2e 하네스 사정으로 기록해둔 것이다). 실패 조건이 같은 윈도우 배치로 한정됐는지 본다.
    it("캡처 실패 조건을 같은 윈도우 배치로 한정한다", () => {
      // `/same window/i` 하나로는 약하다 — 한정 문장을 지워도 뒤따르는 설명에 같은 어구가
      // 남아 통과했다(실측). 한정의 **근거**인 "active는 윈도우별"을 함께 요구한다.
      const before = prose("Before you trigger a capture");
      expect(/per window/i.test(before)).toBe(true);
      expect(/same window/i.test(before)).toBe(true);
      // 별도 윈도우 배치를 실제로 권하는지. prose 경유가 아니면 순수 리랩에 red가 난다.
      expect(/own window/i.test(prose("Order contract"))).toBe(true);
    });

    it("매뉴얼이 말한 '초당 두 번'이 실제 간격 상수와 일치한다", () => {
      // 500ms 간격 = 초당 2회. 이 상수를 올리면 매뉴얼의 수치가 거짓이 되는데, 위 케이스는
      // 같은 파일에서 tab.active만 봐서 잡지 못했다.
      expect(codeOnly(read("src/background/capture-throttle.ts"))).toContain(
        "CAPTURE_MIN_GAP_MS = 500",
      );
      expect(/two per second/i.test(prose("Before you trigger a capture"))).toBe(true);
    });
  });

  describe("본문 입력", () => {
    it("마크다운 붙여넣기가 파싱된다는 주장의 근거가 실재한다", () => {
      const editor = codeOnly(read("src/sidepanel/components/TiptapEditor.tsx"));
      expect(editor).toContain("transformPastedText: true");
      expect(/paste markdown/i.test(prose("Writing the report"))).toBe(true);
    });

    it("제목이 비면 to-preview가 잠긴다는 주장의 근거가 실재한다", () => {
      // 존재 대조만으로는 게이트가 풀려도 green이다. 게이트가 사라지면 매뉴얼은 불필요하게
      // 보수적이 될 뿐이라 피해는 작지만, "이 축을 잰다"고 읽히는 자리라 비워두지 않는다.
      const drafting = codeOnly(read("src/sidepanel/tabs/DraftingPanel.tsx"));
      expect(drafting).toContain("const titleMissing = !draft.title.trim()");
      expect(drafting).toContain("disabled={titleMissing");
      expect(/non-empty/i.test(prose("Writing the report"))).toBe(true);
    });

    it("재현 단계는 행 단위 입력이라 한 번에 붙이면 한 행이 된다고 말한다", () => {
      // `OrderedListEditor`는 행마다 `<Input>`이고 paste 핸들러가 없다 — 붙여넣기를 무시하는
      // 게 아니라 개행이 뭉개져 한 행에 통째로 들어간다. "무시된다"는 에이전트가 실행할 수
      // 없는 서술이라 그 차이가 곧 잘못된 리포트가 된다.
      const editor = codeOnly(read("src/sidepanel/components/OrderedListEditor.tsx"));
      expect(editor).not.toContain("onPaste");
      // 구분자까지 본다 — `next.join(" ")`로 바뀌면 행이 개행으로 합쳐지지 않아 매뉴얼의
      // "개행이 한 행으로 뭉개진다"가 거짓이 되는데, 호출부만 보면 green이다.
      expect(editor).toContain(String.raw`onChange(next.join("\n"))`);
      // "one row per step"은 편집기를 **설명**하는 문장에도 쓰여서, 지시를 지워도 설명이
      // 대신 매치됐다(실측). 실행 지시구를 요구한다.
      expect(/fill one row per step/i.test(prose("Writing the report"))).toBe(true);
    });

    it("heading은 살아남지 않는다고 말한다 — 스키마에 heading 노드가 없다", () => {
      // 첫 판본이 "headings, lists and code fences survive"라고 적었는데 heading은 평문
      // 문단으로 뭉개진다. 에이전트가 `## Steps`로 구조를 잡으면 그게 조용히 사라진다.
      const editor = codeOnly(read("src/sidepanel/components/TiptapEditor.tsx"));
      expect(editor).toContain("heading: false");
      expect(/headings do not survive/i.test(prose("Writing the report"))).toBe(true);
    });
  });
});
