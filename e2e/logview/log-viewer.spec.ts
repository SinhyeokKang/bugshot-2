import {
  test,
  expect,
  openViewer,
  makeActionLog,
  makeConsoleLog,
  makeNetworkLog,
  makeReport,
  stubClipboard,
  NET_BODY_NEEDLE,
  REPORT_COPY_MARKDOWN,
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
    const actionContent = page.locator('[data-entry-id="a-click"] span.break-words');
    await expect(actionContent).toHaveCSS("font-size", "13px");
    await expect(actionContent).toHaveCSS("font-family", /Geist Mono Variable/);

    // 대조 — UI 크롬(필터 탭)은 sans 유지(mono 스택 미포함). 전역 mono 오적용 회귀 가드.
    await expect(page.getByTestId("action-filter-all")).not.toHaveCSS("font-family", /Geist Mono Variable/);
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
    // 유효 1x1 PNG dataUrl (디코드 가능)
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    await openViewer(page, {
      networkLog: makeNetworkLog(),
      screenshot: { dataUrl: png },
    });
    // 분할 레이아웃에서도 로그 탭이 동작.
    await page.getByTestId("logview-tab-network").click();
    await expect(page.locator("[data-entry-id]")).toHaveCount(7);
  });
});
