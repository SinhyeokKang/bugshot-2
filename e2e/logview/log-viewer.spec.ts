import {
  test,
  expect,
  openViewer,
  makeActionLog,
  makeLongUrlActionLog,
  makeNavTypeActionLog,
  makeConsoleLog,
  makeNetworkLog,
  makeReport,
  stubClipboard,
  NET_BODY_NEEDLE,
  REPORT_COPY_MARKDOWN,
  TINY_PNG,
  ORIGIN_A,
  ORIGIN_B,
} from "./fixtures";
import type { Page } from "@playwright/test";

// originKey(pageUrl) === new URL(url).origin (src/sidepanel/lib/logOrigin). 직접 끌어오면
// 그 transitive import(@/lib/session-keys)가 tsconfig.e2e paths 밖이라 인라인한다.
const originKey = (url: string) => new URL(url).origin;

// log-viewer는 확장 없이 dist-log-viewer/index.html을 합성 데이터로 직접 여는 standalone HTML.
// i18n은 navigator.language 기반(src/log-viewer/i18n.ts)이라 Playwright `locale`로 ko/en이 결정적.
// 핵심 회귀: ① 액션 필터 칩이 i18n 키 raw 문자열로 새지 않는다(actionLog.filter.keypress 등),
//          ② 네트워크 검색 placeholder가 본문(body) 검색을 안내한다.

const ACTION_LABELS = {
  ko: { all: "전체", click: "클릭", navigation: "이동", input: "입력", keypress: "키", toggle: "토글", select: "선택" },
  en: { all: "All", click: "Click", navigation: "Navigation", input: "Input", keypress: "Keys", toggle: "Toggle", select: "Select" },
} as const;

type Lang = keyof typeof ACTION_LABELS;

// navigation 유형별 문구. 이 사전은 log-viewer 전용 **복제본**이라 메인 테이블이 갱신돼도
// 안 따라오면 raw 키가 노출된다(POSTMORTEM 2026-06-28·07-26). 여기 값은 리터럴로 박아
// 복제본이 정본을 실제로 따라왔는지를 실 번들 렌더로 확인한다.
const NAV_TEXT = {
  ko: {
    "nv-back": "(으)로 뒤로가기",
    "nv-forward": "(으)로 앞으로가기",
    "nv-reload": " 새로고침",
    "nv-traverse": "(으)로 히스토리 이동",
    "nv-legacy": "(으)로 이동",
  },
  en: {
    "nv-back": "Went back to",
    "nv-forward": "Went forward to",
    "nv-reload": "Reloaded",
    "nv-traverse": "Navigated via history to",
    "nv-legacy": "Navigated to",
  },
} as const;

// ko는 {target}이 문두라 좁은 폭에서 판별어가 잘린다 — 아이콘이 유일한 판별축이다.
const NAV_ICON_CLASS = {
  "nv-back": "lucide-arrow-left",
  "nv-forward": "lucide-arrow-right",
  "nv-reload": "lucide-rotate-cw",
  "nv-traverse": "lucide-history",
  "nv-legacy": "lucide-map-pin",
} as const;

// ko/en 공용 라벨·placeholder 검증 — i18n 회귀의 단일 출처.
function labelSuite(lang: Lang, locale: string) {
  test.describe(`i18n labels — ${lang}`, () => {
    test.use({ locale });

    test("액션 필터 칩이 정확한 라벨 — raw i18n 키 미노출 (keypress/toggle/select 회귀)", async ({ page }) => {
      await openViewer(page, { actionLog: makeActionLog() });
      await page.getByTestId("logview-tab-action").click();

      const want = ACTION_LABELS[lang];
      for (const [f, label] of Object.entries(want)) {
        const chip = page.getByTestId(`action-filter-${f}`);
        await expect(chip).toHaveText(label);
        // raw 키("actionLog.filter.keypress")는 "Log.filter"를 포함 — 정상 라벨엔 없다.
        await expect(chip).not.toContainText("Log.filter");
      }
    });

    // 사이드패널 spec은 이 표면을 못 덮는다 — markers.ts·TimelineRow가 별도 번들이다.
    test("navigation 유형별 문구가 복제 사전에서 해결된다 (raw 키 미노출)", async ({ page }) => {
      await openViewer(page, { actionLog: makeNavTypeActionLog() });
      await page.getByTestId("logview-tab-action").click();

      for (const [id, text] of Object.entries(NAV_TEXT[lang])) {
        const row = page.locator(`[data-entry-id="${id}"]`);
        await expect(row).toContainText(text);
        // raw 키("actionLog.verb.navigateBack")는 "actionLog.verb"를 포함 — 정상 문구엔 없다.
        await expect(row).not.toContainText("actionLog.verb");
      }
    });

    test("navigation 유형별 아이콘이 서로 다르고 구 값은 MapPin 폴백", async ({ page }) => {
      await openViewer(page, { actionLog: makeNavTypeActionLog() });
      await page.getByTestId("logview-tab-action").click();

      for (const [id, cls] of Object.entries(NAV_ICON_CLASS)) {
        await expect(page.locator(`[data-entry-id="${id}"] svg.${cls}`)).toHaveCount(1);
      }
    });

    test("네트워크 필터 칩도 raw 키 미노출", async ({ page }) => {
      await openViewer(page, { networkLog: makeNetworkLog() });
      // 기본 탭이 network(console 없음). json/js/css/img/doc/other/all 칩 present.
      for (const f of ["all", "json", "js", "css", "img", "doc", "other"]) {
        await expect(page.getByTestId(`network-filter-${f}`)).not.toContainText("Log.filter");
      }
    });

    test("네트워크 검색 placeholder가 본문 검색 안내 (search placeholder stale 회귀)", async ({ page }) => {
      await openViewer(page, { networkLog: makeNetworkLog() });
      const search = page.getByTestId("network-search");
      const needle = lang === "ko" ? "본문" : "body";
      await expect(search).toHaveAttribute("placeholder", new RegExp(needle, "i"));
      // URL만 검색하던 옛 문구로 회귀하지 않았는지 — 정확값 고정.
      await expect(search).toHaveAttribute(
        "placeholder",
        lang === "ko" ? "URL·본문 검색…" : "Search URL & body…",
      );
    });
  });
}

labelSuite("ko", "ko-KR");
labelSuite("en", "en-US");

// blob URL `<a download>` 클릭 → download 이벤트로 파일명 판정(download-buttons.spec 패턴).
async function expectDownload(page: Page, testId: string, filename: string): Promise<void> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(testId).click(),
  ]);
  expect(download.suggestedFilename()).toBe(filename);
}

// 동작·구조 — locale 무관(en 고정).
test.describe("behavior", () => {
  test.use({ locale: "en-US" });

  test("Report 탭 — 제목·env·섹션 렌더 + 마크다운 복사", async ({ page }) => {
    await openViewer(page, { report: makeReport() });
    await stubClipboard(page);
    await page.getByTestId("logview-tab-report").click();

    await expect(page.getByRole("heading", { name: "Login button misaligned" })).toBeVisible();
    await expect(page.locator('[data-testid="env-row"]')).toHaveCount(2);
    await expect(page.locator('[data-env-label="URL"]')).toContainText("http://alpha.e2e/login");
    await expect(page.getByTestId("preview-section-description")).toContainText("login button overflows");
    // orderedList 섹션 — 2개 항목
    await expect(page.getByTestId("preview-section-steps").locator("ol > li")).toHaveCount(2);

    // copy 클릭 → write(rich) reject → writeText(markdown) 폴백 → __copiedText 저장 + Check 아이콘
    await page.getByTestId("copy-markdown").click();
    await expect(page.getByTestId("copy-markdown").locator("svg.lucide-check")).toBeVisible();
    const copied = await page.evaluate(() => (window as unknown as { __copiedText: string | null }).__copiedText);
    expect(copied).toBe(REPORT_COPY_MARKDOWN);
  });

  test("다운로드 버튼 — 탭별 JSON/HAR 파일명", async ({ page }) => {
    await openViewer(page, {
      consoleLog: makeConsoleLog(),
      networkLog: makeNetworkLog(),
      actionLog: makeActionLog(),
    });
    // 기본 탭=console.
    await expectDownload(page, "download-console-json", "Console-log.json");
    await page.getByTestId("logview-tab-network").click();
    await expectDownload(page, "download-network-har", "Network-log.har");
    await page.getByTestId("logview-tab-action").click();
    await expectDownload(page, "download-action-json", "Action-log.json");
  });

  test("탭 전환 + badge count (console→network→action)", async ({ page }) => {
    await openViewer(page, {
      actionLog: makeActionLog(),
      consoleLog: makeConsoleLog(),
      networkLog: makeNetworkLog(),
    });
    // 기본 탭 = console(우선순위). badge에 항목 수.
    await expect(page.getByTestId("logview-tab-console")).toContainText("5");
    await expect(page.getByTestId("logview-tab-network")).toContainText("7");
    await expect(page.getByTestId("logview-tab-action")).toContainText("6");

    await page.getByTestId("logview-tab-network").click();
    await expect(page.getByTestId("network-search")).toBeVisible();

    await page.getByTestId("logview-tab-action").click();
    await expect(page.getByTestId("action-search")).toBeVisible();
  });

  test("액션 필터링 — keypress 필터 클릭 시 keypress 행만", async ({ page }) => {
    await openViewer(page, { actionLog: makeActionLog() });
    await page.getByTestId("logview-tab-action").click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(6);

    await page.getByTestId("action-filter-keypress").click();
    await expect(page.locator('[data-kind="keypress"]')).toHaveCount(1);
    await expect(page.locator("[data-entry-id]")).toHaveCount(1);

    await page.getByTestId("action-filter-all").click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(6);
  });

  test("네트워크 본문 검색 — URL엔 없는 마커가 응답 본문에 매칭", async ({ page }) => {
    await openViewer(page, { networkLog: makeNetworkLog() });
    await expect(page.locator("[data-entry-id]")).toHaveCount(7);

    await page.getByTestId("network-search").fill(NET_BODY_NEEDLE);
    // 200ms 디바운스 — toHaveCount 재시도로 흡수. n-json만 본문에 마커.
    await expect(page.locator("[data-entry-id]")).toHaveCount(1);
    await expect(page.locator('[data-entry-id="n-json"]')).toBeVisible();

    await page.getByTestId("network-search").fill("");
    await expect(page.locator("[data-entry-id]")).toHaveCount(7);
  });

  test("콘솔 필터 + 검색", async ({ page }) => {
    await openViewer(page, { consoleLog: makeConsoleLog() });
    await expect(page.locator("[data-entry-id]")).toHaveCount(5);

    // 레벨 필터(error만)
    await page.getByTestId("console-filter-error").click();
    await expect(page.locator('[data-level="error"]')).toHaveCount(1);
    await expect(page.locator("[data-entry-id]")).toHaveCount(1);
    await page.getByTestId("console-filter-all").click();

    // 본문 검색
    await page.getByTestId("console-search").fill("zqxconsoleneedle");
    await expect(page.locator("[data-entry-id]")).toHaveCount(1);
    await expect(page.locator('[data-entry-id="c-err"]')).toBeVisible();
  });

  test("origin 필터 — 2 origin 노출·필터링·해제", async ({ page }) => {
    await openViewer(page, { actionLog: makeActionLog() });
    await page.getByTestId("logview-tab-action").click();

    const keyA = originKey(ORIGIN_A);
    const keyB = originKey(ORIGIN_B);
    await expect(page.locator('[data-testid="origin-filter"]')).toHaveCount(2);

    // alpha origin(click/nav/input/keypress = 4건)만
    await page.locator(`[data-testid="origin-filter"][data-origin="${keyA}"]`).click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(4);

    // beta origin(toggle/select = 2건)
    await page.locator(`[data-testid="origin-filter"][data-origin="${keyB}"]`).click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(2);

    // 해제 → 전체
    await page.locator(`[data-testid="origin-filter"][data-origin="${keyB}"]`).click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(6);
  });

  // 유닛 테스트는 className 문자열만 본다 — 실제 렌더 크기·서체 적용은 못 본다(POSTMORTEM
  // 2026-07-17: 크기 불변식이 깨져도 pnpm test green). computed style로 실측한다. log-viewer는
  // Geist @font-face가 없어 시스템 mono로 폴백하지만, font-mono가 깔아둔 선언 스택
  // ("Geist Mono Variable", …)은 computed font-family 문자열에 그대로 남아 sans와 구별된다.
  test("로그 표면 mono 실측 — 콘솔 메시지·액션 행이 13px + mono 서체(className 아닌 렌더)", async ({ page }) => {
    await openViewer(page, { consoleLog: makeConsoleLog(), actionLog: makeActionLog() });

    // 콘솔 접힘 메시지 span (기본 탭=console, c-log는 stack 없어 접힌 채)
    const consoleMsg = page.locator('[data-entry-id="c-log"] span.break-all');
    await expect(consoleMsg).toHaveCSS("font-size", "13px");
    await expect(consoleMsg).toHaveCSS("font-family", /Geist Mono Variable/);

    // 액션 행 콘텐츠 span
    await page.getByTestId("logview-tab-action").click();
    // 레이아웃 슬롯(flex-1)으로 잡는다 — wrap 클래스로 잡으면 그 클래스를 바꿀 때 이 단언이
    // 함께 죽는다(실제로 break-words → [overflow-wrap:anywhere] 교체에서 밟았다).
    const actionContent = page.locator('[data-entry-id="a-click"] span.flex-1');
    await expect(actionContent).toHaveCSS("font-size", "13px");
    await expect(actionContent).toHaveCSS("font-family", /Geist Mono Variable/);

    // 대조 — UI 크롬(필터 탭)은 sans 유지(mono 스택 미포함). 전역 mono 오적용 회귀 가드.
    await expect(page.getByTestId("action-filter-all")).not.toHaveCSS("font-family", /Geist Mono Variable/);
  });

  // Radix ScrollArea Viewport는 자식을 `min-width:100%; display:table` div로 감싼다 → shrink-to-fit
  // 사이징이라 폭이 콘텐츠를 따라간다. 그런데 `overflow-wrap:break-word`는 스펙상 min-content 폭에
  // 기여하지 않아서(줄은 접혀도 자연 폭은 그대로), 긴 URL 한 덩어리가 table을 뷰포트 밖으로
  // 밀어낸다. 가로 스크롤바는 Radix가 숨기고 ScrollBar도 vertical만 렌더하므로 넘친 URL엔 닿을
  // 방법이 없다 — 잘린 채로 끝난다. 그래서 `overflow-wrap:anywhere`라야 한다.
  //
  // className 단언(`toHaveClass`)으로는 못 지킨다 — 구현을 복사해 적는 것이라 ScrollArea를
  // 교체하거나 Radix가 display:table을 걷어내도 조용히 통과한다. jsdom도 못 본다(레이아웃 엔진이
  // 없어 scrollWidth·clientWidth가 항상 0). 실 브라우저 실측이 유일한 그물이다.
  //
  // **분할 모드로 여는 것이 이 테스트의 전제다.** 단일 패널(1280px)에선 같은 URL로도 table이
  // 뷰포트 안에 머물러 깨진 구현이 green으로 통과한다(실측: 자연 폭 2129px, 단일 패널 1256px →
  // overflow 0 / 분할 495px → overflow 174). 재현 조건은 "URL 자연 폭 ≫ 패널 폭"이고, 아래
  // 전제 1이 그 비율을 직접 단언해 조건이 무너지면 판정보다 먼저 red를 낸다.
  test("긴 URL 액션 행 — 좁은 패널 ScrollArea(display:table)에서 접히고 가로로 안 넘친다", async ({ page }) => {
    await openViewer(page, { actionLog: makeLongUrlActionLog(), screenshot: { dataUrl: TINY_PNG } });
    await page.getByTestId("logview-tab-action").click();

    const link = page.getByTestId("action-nav-link");
    await expect(link).toBeVisible();

    const m = await link.evaluate((el) => {
      const span = el.closest("span.flex-1")!;
      const vp = el.closest("[data-radix-scroll-area-viewport]") as HTMLElement;
      // 자연 폭(max-content) — 같은 서체·크기를 물려받도록 제자리에 복제해 nowrap으로 편다.
      const probe = el.cloneNode(true) as HTMLElement;
      probe.style.cssText = "white-space:nowrap;position:absolute;visibility:hidden;left:-9999px";
      span.appendChild(probe);
      const natural = probe.getBoundingClientRect().width;
      probe.remove();
      return {
        natural,
        lines: el.getClientRects().length,
        client: vp.clientWidth,
        overflow: vp.scrollWidth - vp.clientWidth,
      };
    });

    // 전제 1 — URL 자연 폭이 패널 폭의 배 이상이라야 버그가 재현된다. 픽스처 URL이 짧아지거나
    // 레이아웃이 넓어지면 아래 판정이 공허해지므로 그 전에 여기서 죽는다.
    expect(m.natural).toBeGreaterThan(m.client * 2);
    // 전제 2 — 그 결과 행이 실제로 접혔다(inline 요소는 줄마다 client rect가 하나씩 생긴다).
    expect(m.lines).toBeGreaterThan(1);

    // 판정 — 접혔으면 가로로는 넘치지 않아야 한다. break-words면 table이 URL 폭을 따라 늘어난다.
    expect(m.overflow).toBe(0);
  });

  test("빈 상태 — 없는 로그 타입도 탭 활성 + 0 배지 + EmptyCase (사이드패널 정책 통일)", async ({ page }) => {
    // actionLog만 → console/network는 미보유. 정책 통일로 disabled가 아니라 활성 + EmptyCase.
    await openViewer(page, { actionLog: makeActionLog() });
    await expect(page.getByTestId("logview-tab-console")).toBeEnabled();
    await expect(page.getByTestId("logview-tab-network")).toBeEnabled();
    await expect(page.getByTestId("logview-tab-action")).toBeEnabled();
    // 0건도 배지 노출.
    await expect(page.getByTestId("logview-tab-console")).toContainText("0");
    await expect(page.getByTestId("logview-tab-network")).toContainText("0");
    // 빈 탭 조회 시 항목 없음(EmptyCase) — 활성 탭만 visible이라 :visible로 스코프.
    await page.getByTestId("logview-tab-console").click();
    await expect(page.locator("[data-entry-id]:visible")).toHaveCount(0);
  });

  test("분할 모드 — screenshot 좌측 패널과 로그 탭 공존", async ({ page }) => {
    await openViewer(page, {
      networkLog: makeNetworkLog(),
      screenshot: { dataUrl: TINY_PNG },
    });
    // 분할 레이아웃에서도 로그 탭이 동작.
    await page.getByTestId("logview-tab-network").click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(7);
  });
});
