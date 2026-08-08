import type { Frame, Page } from "@playwright/test";

import {
  assertGatesSatisfied,
  assertHypothesesSeparable,
  proceedToDrafting,
  settleBeforeCapture,
  snapshotAspect,
} from "./fixtures/capture-aspect";
import {
  enterDebug,
  expect,
  test,
  typeStyleValue,
  type ExtContext,
} from "./fixtures/extension";

const FRAME_ID = "__bugshot_device_frame__";
const STYLE_ID = "__bugshot_device_style__";

// 최초 ON 진입 1회 경고는 chrome.storage.local에 영속돼 worker의 persistent context 전체가
// 공유한다 — spec 순서에 기대면 다이얼로그 기대가 실행 순서에 따라 갈린다. 각 테스트가
// 자기 전제를 직접 세운다(design.md "시나리오 순서 결합 주의").
async function setModeWarned(ext: ExtContext, warned: boolean): Promise<void> {
  await ext.evalInExt(async (value: boolean) => {
    const KEY = "bugshot-app-settings";
    const stored = (await chrome.storage.local.get(KEY))[KEY] as string | undefined;
    let parsed: { state?: Record<string, unknown>; version?: number } = {};
    try {
      parsed = stored ? JSON.parse(stored) : {};
    } catch {
      parsed = {};
    }
    parsed.state = { ...(parsed.state ?? {}), deviceModeWarned: value };
    parsed.version = parsed.version ?? 10;
    await chrome.storage.local.set({ [KEY]: JSON.stringify(parsed) });
  }, warned);
}

const hasWrapper = (fixture: Page) =>
  fixture.evaluate((id) => !!document.getElementById(id), FRAME_ID);

const wrapperWidth = (fixture: Page) =>
  fixture.evaluate((id) => {
    const el = document.getElementById(id) as HTMLIFrameElement | null;
    return el?.contentWindow?.innerWidth ?? null;
  }, FRAME_ID);

/**
 * 래퍼 프레임(= 모드 ON에서 사용자가 실제로 보는 문서). top과 URL이 같아 참조로만 가른다.
 * 커밋 직후의 프레임을 잡으면 첫 evaluate가 "Frame was detached"로 죽으므로, 평가가
 * 실제로 통하는 프레임이 나올 때까지 폴링한다(래퍼는 mount 직후 한 번 더 커밋될 수 있다).
 */
async function waitForWrapperFrame(fixture: Page): Promise<Frame> {
  let found: Frame | null = null;
  await expect(async () => {
    const candidate =
      fixture.frames().find((f) => f !== fixture.mainFrame() && !f.isDetached()) ?? null;
    expect(candidate).not.toBeNull();
    expect(await candidate!.evaluate(() => document.readyState)).not.toBe("loading");
    found = candidate;
  }).toPass({ timeout: 20_000 });
  return found!;
}

// 전이 중에는 행 전체가 aria-busy + 전 세그먼트 aria-disabled다(XFO 사이트는 판정에만 최대
// 3초). 앞선 전환이 끝나기 전에 다음 세그먼트를 누르려 하면 disabled 단언이 그대로 죽으므로,
// 클릭 전에 busy가 걷히는 것을 먼저 기다린다.
async function waitForIdle(panel: Page): Promise<void> {
  await expect(panel.getByTestId("device-viewport-bar")).not.toHaveAttribute(
    "aria-busy",
    "true",
    { timeout: 30_000 },
  );
}

/** 세그먼트 선택 → 래퍼 폭 반영 → 전이 완료(busy 해제)까지. 모드 ON을 전제로 하는 단언은
 *  전부 이 뒤에 와야 한다 — clear는 stop ACK 뒤·start ACK 앞이라 그 창이 관측 가능하다. */
async function enterDeviceMode(panel: Page, fixture: Page, width: number): Promise<void> {
  await selectWidth(panel, String(width));
  await expect(async () => {
    expect(await wrapperWidth(fixture)).toBe(width);
  }).toPass({ timeout: 20_000 });
  await waitForIdle(panel);
  // 전이가 끝난 **뒤에** 다시 본다 — 위 폴링은 롤백 직전의 순간을 잡을 수 있고 busy는 롤백이
  // 끝나야 풀리므로, 이 두 줄이 없으면 "마운트됐다가 되돌아감"이 성공으로 통과한다.
  await expect(panel.getByTestId(`device-preset-${width}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await wrapperWidth(fixture)).toBe(width);
}

async function selectWidth(panel: Page, key: string): Promise<void> {
  await waitForIdle(panel);
  const seg = panel.getByTestId(`device-preset-${key}`);
  await expect(seg).toBeVisible();
  await expect(seg).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
  await seg.click();

  // settings 스토어는 chrome.storage.local에서 비동기 하이드레이트된다 — 갓 연 패널에서
  // 클릭이 그보다 빠르면 이미 소비한 1회 경고가 기본값(false)으로 한 번 더 뜬다. 사용자
  // 입장에선 [계속]을 누르면 그만이라 여기서도 그렇게 흘려보낸다(경고 자체의 단언은
  // 전용 테스트가 소유한다).
  const dialog = panel.getByRole("alertdialog");
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button").last().click();
  }
}


interface Bench {
  fixture: Page;
  panel: Page;
}

async function openBench(
  ext: ExtContext,
  marker: string,
  opts: { page?: string; warned?: boolean; viewport?: { width: number; height: number } } = {},
): Promise<Bench> {
  await setModeWarned(ext, opts.warned ?? true);
  const fixture = await ext.context.newPage();
  if (opts.viewport) await fixture.setViewportSize(opts.viewport);
  const page = opts.page ?? "basic.html";
  await fixture.goto(`${ext.fixtureUrl(page)}?dv=${marker}`);
  const tabId = await ext.fixtureTabId(`http://127.0.0.1/${page}?dv=${marker}`);
  const panel = await ext.openPanel(tabId);
  await enterDebug(panel);
  return { fixture, panel };
}

test.describe("디바이스 뷰포트", () => {
  // 실패로 close가 건너뛰어져도 다음 테스트의 fixtureTabId가 잔여 탭을 잡지 않게 정리한다
  // (worker fixture는 persistent context를 공유한다 — README "spec 간 탭 누수").
  test.afterEach(async ({ ext }) => {
    for (const page of ext.context.pages()) {
      const url = page.url();
      if (url.startsWith("http://127.0.0.1") || url.includes("/src/sidepanel/index.html")) {
        await page.close().catch(() => {});
      }
    }
  });

  test("기본은 전체 — 페이지에 래퍼가 없다", async ({ ext }) => {
    const { fixture, panel } = await openBench(ext, "default");

    await expect(panel.getByTestId("device-viewport-bar")).toBeVisible();
    // TabsContent 없이 TabsList만 쓰는 세그먼티드 컨트롤이라 data-state는 "closed"로 남는다 —
    // 선택 신호는 aria-selected다(StyleEditorPanel 선례와 동일 구조).
    await expect(panel.getByTestId("device-preset-full")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await hasWrapper(fixture)).toBe(false);

    await panel.close();
    await fixture.close();
  });

  test("최초 ON 진입에서 경고가 1회 뜨고, 취소하면 모드가 안 켜진다", async ({ ext }) => {
    const { fixture, panel } = await openBench(ext, "warn", { warned: false });

    await selectWidth(panel, "390");
    const dialog = panel.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // 취소는 마운트까지 가지 않는다 — 경고가 게이트라는 것이 이 단언의 요지다.
    await dialog.getByRole("button").first().click();
    await expect(dialog).toBeHidden();
    expect(await hasWrapper(fixture)).toBe(false);

    await panel.close();
    await fixture.close();
  });

  test("390을 고르면 래퍼가 서고 그 안 innerWidth와 미디어쿼리가 390 기준이다", async ({
    ext,
  }) => {
    const { fixture, panel } = await openBench(ext, "off");

    await enterDeviceMode(panel, fixture, 390);

    // 폭만 줄인 게 아니라 독립 뷰포트여야 한다 — transform/zoom 안이었다면 여기가 false다.
    const wrapper = await waitForWrapperFrame(fixture);
    expect(await wrapper.evaluate(() => matchMedia("(max-width: 767px)").matches)).toBe(
      true,
    );
    // 원본은 감춰지되 인라인 style은 건드리지 않는다(은닉이 스타일시트 한 장).
    expect(
      await fixture.evaluate(
        (id) => getComputedStyle(document.querySelector(`body > *:not(#${id})`)!).display,
        FRAME_ID,
      ),
    ).toBe("none");

    await panel.close();
    await fixture.close();
  });

  test("390→768은 iframe 노드가 유지된 채 폭만 바뀐다 (재로드 없는 경량 경로)", async ({
    ext,
  }) => {
    // 가용 폭이 768 미만이면 그 세그먼트가 정당하게 잠긴다(e2e 기본 창은 480px다) — 폭 전환
    // 경로를 보려는 테스트라 가용 폭을 먼저 확정한다. 패널보다 먼저 잡아야 최초 device.state가
    // 이 값을 싣는다.
    const { fixture, panel } = await openBench(ext, "resize", {
      viewport: { width: 1200, height: 800 },
    });

    await enterDeviceMode(panel, fixture, 390);

    // 노드 동일성 마커 — 재로드가 끼면 이 속성이 사라진다.
    await fixture.evaluate((id) => {
      document.getElementById(id)!.setAttribute("data-e2e-mark", "1");
    }, FRAME_ID);

    await selectWidth(panel, "768");
    await expect(async () => {
      expect(await wrapperWidth(fixture)).toBe(768);
    }).toPass({ timeout: 20_000 });

    expect(
      await fixture.evaluate(
        (id) => document.getElementById(id)?.getAttribute("data-e2e-mark") ?? null,
        FRAME_ID,
      ),
    ).toBe("1");
    // 폭 전환에 차단 판정이 붙으면 여기서 모드가 통째로 풀린다.
    await expect(panel.getByTestId("device-preset-768")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await panel.close();
    await fixture.close();
  });

  test("전체로 되돌리면 래퍼와 주입 스타일이 둘 다 사라진다", async ({ ext }) => {
    const { fixture, panel } = await openBench(ext, "logs");

    await enterDeviceMode(panel, fixture, 390);

    await selectWidth(panel, "full");
    await expect(async () => {
      expect(await hasWrapper(fixture)).toBe(false);
      expect(
        await fixture.evaluate((id) => !!document.getElementById(id), STYLE_ID),
      ).toBe(false);
    }).toPass({ timeout: 20_000 });

    await panel.close();
    await fixture.close();
  });

  // 이 기능의 가장 조용한 실패 — 숨겨진 top 레코더가 되살아나면 에러 없이 엔트리만 2벌이 된다.
  test("모드 ON에서 console.log 1회가 로그 탭에 1건만 쌓인다", async ({ ext }) => {
    const { fixture, panel } = await openBench(ext, "pick");

    await enterDeviceMode(panel, fixture, 390);

    await panel.getByTestId("subtab-console").click();
    const marker = `bugshot-e2e-device-once-${Date.now()}`;
    const wrapper = await waitForWrapperFrame(fixture);

    await expect(async () => {
      await wrapper.evaluate((m) => console.log(m), marker);
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator("[data-entry-id]", { hasText: marker }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // 한 번 더 sync를 돌려도 여전히 1건 — 되살아난 top이 있으면 2건이 된다.
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]", { hasText: marker })).toHaveCount(1);

    await panel.close();
    await fixture.close();
  });

  // 위험 8 — 래퍼가 registry에 등록되지 않으면 모드 ON에서 아무 요소도 못 고른다.
  test("모드 ON에서 래퍼 안의 요소를 선택할 수 있다", async ({ ext }) => {
    const { fixture, panel } = await openBench(ext, "fullpage");

    await enterDeviceMode(panel, fixture, 390);

    await panel.getByTestId("mode-element").click();
    const wrapper = await waitForWrapperFrame(fixture);

    await expect(async () => {
      const box = await wrapper.locator("#title").boundingBox();
      expect(box).not.toBeNull();
      await fixture.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await fixture.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(panel.getByTestId("repick")).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });

    await panel.close();
    await fixture.close();
  });

  /**
   * 래퍼는 **비-top 프레임**이라 캡처 응답이 `respondWithTopRect`로 top 좌표에 재조립되는데,
   * 거기서 확장 판정(`contextSelector`)이 떨어지면 before는 컨테이너 rect로 크롭되고 after는
   * 확장을 요청조차 하지 않아 요소 bbox로 찍힌다. 두 기준이 갈려도 `sameCaptureBasis`는 양쪽
   * null을 같다고 읽으므로 **에러도 stale 표시도 없다** — 그래서 이미지 종횡비가 유일한 그물이다.
   * `capture-context.spec.ts`는 전부 top 문서 전용이라 이 경로를 덮지 못한다.
   */
  test("모드 ON에서 컨테이너 확장 기준이 before·after 양쪽에 똑같이 걸린다", async ({
    ext,
  }) => {
    const { fixture, panel } = await openBench(ext, "basis", {
      page: "capture-context.html",
    });

    await enterDeviceMode(panel, fixture, 390);
    const wrapper = await waitForWrapperFrame(fixture);

    // 게이트는 래퍼 뷰포트(390 × top 높이) 기준으로 판정된다 — top으로 재면 60vw 모달이
    // 다른 크기로 읽혀 "확장 안 걸림"이 구현 회귀인지 픽스처 붕괴인지 갈리지 않는다.
    await assertGatesSatisfied(wrapper, "#modal", "#modal-btn");

    await panel.getByTestId("mode-element").click();
    // boundingBox는 프레임 오프셋을 반영한 메인 프레임 좌표를 준다(래퍼는 가운데 정렬이라 x≠0).
    await expect(async () => {
      const box = await wrapper.locator("#modal-btn").boundingBox();
      expect(box).not.toBeNull();
      await fixture.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await fixture.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(panel.getByTestId("repick")).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });

    await settleBeforeCapture(fixture);
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(wrapper.locator("#modal-btn")).toHaveCSS("color", "rgb(255, 0, 0)");

    await proceedToDrafting(panel, fixture);

    const { container } = await assertHypothesesSeparable(wrapper, "#modal", "#modal-btn");
    expect(await snapshotAspect(panel, "before")).toBeCloseTo(container, 1);
    expect(await snapshotAspect(panel, "after")).toBeCloseTo(container, 1);

    await panel.close();
    await fixture.close();
  });

  // 스크롤 캡처 오케스트레이터는 frameId 0 고정이라 모드 ON이면 "조용한 1타일"이 된다 —
  // 에러도 truncated 배지도 안 뜨므로 잠금 자체가 유일한 방어다.
  test("모드 ON에서 페이지 전체 캡처가 잠기고 클릭해도 캡처가 시작되지 않는다", async ({
    ext,
  }) => {
    await setModeWarned(ext, true);
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/basic.html");
    const panel = await ext.openPanel(tabId);
    await enterDebug(panel);

    await enterDeviceMode(panel, fixture, 390);

    await panel.getByTestId("mode-screenshot").click();
    const fullPage = panel.getByTestId("capture-method-fullpage");
    await expect(fullPage).toBeVisible();
    await expect(fullPage).toHaveAttribute("aria-disabled", "true");
    // 잠금 사유가 접근명을 오염시키면 안 된다 — label 하나가 aria-label과 툴팁을 겸하므로
    // 사유를 label로 밀어넣으면 접근명이 안내 문장으로 바뀐다. `/.+/`로는 그걸 못 잡는다.
    await expect(fullPage).toHaveAttribute("aria-label", /^(페이지 캡처|Page capture)$/);

    await fullPage.evaluate((el) => (el as HTMLElement).click());
    await panel.waitForTimeout(1500);
    await expect(panel.getByTestId("drafting-panel")).toBeHidden();
    await expect(fullPage).toBeVisible();

    await panel.close();
    await fixture.close();
  });

  // 진입 시점 차단 — background가 단독으로 판정하고 사이드패널이 전체로 롤백한다.
  test("X-Frame-Options: DENY 페이지에서는 3초 안에 전체로 롤백된다", async ({ ext }) => {
    const { fixture, panel } = await openBench(ext, "xfo", { page: "e2e-xfo" });

    await selectWidth(panel, "390");

    // 롤백 후 상태(`전체` 선택)는 **시작 상태와 같다** — 클릭이 통째로 무시돼도 통과하므로,
    // 전이가 실제로 착수됐다는 것을 먼저 본 뒤에 되돌아오는 것을 본다.
    await expect(panel.getByTestId("device-viewport-bar")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(panel.getByTestId("device-preset-full")).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 20_000 },
    );
    // 롤백 뒤 원본이 그대로 보여야 한다(래퍼만 걷히고 페이지는 살아 있다).
    await expect(async () => {
      expect(await hasWrapper(fixture)).toBe(false);
    }).toPass({ timeout: 20_000 });
    await expect(fixture.locator("#xfo-marker")).toBeVisible();

    await panel.close();
    await fixture.close();
  });
});
