import type { Frame, Page } from "@playwright/test";
import {
  enterDebug,
  expect,
  pickElement,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// picker all_frames 지원 — 1-depth iframe 내부 요소 선택·편집·버퍼 분리·teardown.
// 캡처(크롭 좌표 정확도·top overlay 미포함)는 captureVisibleTab flaky로 수동 잔여(GOTCHAS).

const OVERLAY_ID = "__bugshot_picker_host";

function overlayInTop(fixture: Page): Promise<boolean> {
  return fixture.evaluate(
    (id) => !!document.getElementById(id),
    OVERLAY_ID,
  );
}

function overlayInFrame(fixture: Page, urlPart: RegExp): Promise<boolean> {
  const frame = fixture.frame({ url: urlPart });
  if (!frame) return Promise.resolve(false);
  return frame.evaluate((id) => !!document.getElementById(id), OVERLAY_ID);
}

// 프레임 하나의 오버레이 shadow root에서 배너 상태를 읽는다(없으면 count 0).
function bannerIn(target: Page | Frame): Promise<{ count: number; text: string | null }> {
  return target.evaluate((id) => {
    const shadow = document.getElementById(id)?.shadowRoot;
    const banners = shadow ? shadow.querySelectorAll(".banner") : [];
    return {
      count: banners.length,
      text: banners.length ? (banners[0].textContent ?? "") : null,
    };
  }, OVERLAY_ID);
}

interface LabelBox {
  left: number;
  right: number;
  width: number;
  vpW: number;
  // 폭 제약(maxWidth/minWidth)을 푼 복제본의 폭 — 전제 단언용.
  naturalW: number;
}

// hover 라벨의 rect + "제약을 풀었을 때의 자연 폭"을 함께 잰다. 자연 폭은 실물을 건드리지 않게
// 복제본으로 재고 즉시 제거한다(라벨은 position:fixed라 레이아웃에 영향 없음).
function labelBoxIn(frame: Frame): Promise<LabelBox | null> {
  return frame.evaluate((id) => {
    const shadow = document.getElementById(id)?.shadowRoot;
    const label = shadow?.querySelector<HTMLElement>(".picker-label");
    if (!shadow || !label || getComputedStyle(label).display === "none") return null;

    const clone = label.cloneNode(true) as HTMLElement;
    clone.style.maxWidth = "";
    clone.style.minWidth = "";
    clone.style.left = "0px";
    clone.style.top = "0px";
    clone.style.visibility = "hidden";
    clone.style.display = "block";
    shadow.appendChild(clone);
    const naturalW = clone.getBoundingClientRect().width;
    clone.remove();

    const r = label.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      width: r.width,
      vpW: window.innerWidth,
      naturalW,
    };
  }, OVERLAY_ID);
}

test.describe.serial("picker-iframe (same-origin)", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("iframe.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  async function repickTo(selector: string, frame?: string) {
    await panel.getByTestId("repick").click();
    // 버퍼 스냅샷 캡처가 끝나야 startPicker가 발송된다 — repick 소실이 신호.
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, selector, { frame });
  }

  test("1. picking 중 iframe에서 ESC → 전 프레임 picker 정리 + idle", async () => {
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();

    // picker.start broadcast로 top·iframe 양쪽에 overlay가 깔린다.
    await expect.poll(() => overlayInTop(fixture)).toBe(true);
    await expect.poll(() => overlayInFrame(fixture, /basic\.html/)).toBe(true);

    // iframe 문서에 ESC — 발화 프레임만 idle이 되면 top이 유령으로 남는다(teardown 검증).
    await fixture.frameLocator("#frame").locator("body").press("Escape");

    await expect(panel.getByTestId("mode-element")).toBeVisible();
    // clearPicker broadcast로 top·iframe overlay 모두 제거.
    await expect.poll(() => overlayInTop(fixture)).toBe(false);
    await expect.poll(() => overlayInFrame(fixture, /basic\.html/)).toBe(false);
  });

  test("2. iframe 내부 요소 선택 → 스타일 에디터 로드", async () => {
    await panel.getByTestId("mode-element").click();
    await pickElement(fixture, panel, "#title", { frame: "#frame" });
    await expect(panel.getByTestId("repick")).toBeVisible();
  });

  test("3. color 편집 → iframe 내부 DOM에 반영", async () => {
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(
      fixture.frameLocator("#frame").locator("#title"),
    ).toHaveCSS("color", "rgb(255, 0, 0)");
  });

  test("4. top 요소 재선택 → 두 편집이 버퍼에 각각 유지 + same-origin은 배지 없음", async () => {
    await repickTo("#top-title");
    await typeStyleValue(panel, "width", "222px");
    await expect(fixture.locator("#top-title")).toHaveCSS("width", "222px");
    // iframe 편집은 버퍼로 내려가 그대로 유지.
    await expect(
      fixture.frameLocator("#frame").locator("#title"),
    ).toHaveCSS("color", "rgb(255, 0, 0)");

    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    await expect(panel.getByTestId("changes-card")).toHaveCount(2);
    // same-origin iframe은 페이지 origin과 같아 출처 배지를 만들지 않는다.
    await expect(panel.getByTestId("origin-badge")).toHaveCount(0);
  });

  test("5. 버퍼(iframe) 행 초기화 → iframe 프레임 DOM 원복 (frameId 라우팅)", async () => {
    const bufferedRow = panel
      .locator('[data-testid="changes-card"][data-source="buffered"]')
      .locator('[data-testid="changes-row"][data-prop="color"]');
    await bufferedRow.getByTestId("reset-row").click();

    await expect(
      fixture.frameLocator("#frame").locator("#title"),
    ).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(panel.getByTestId("changes-card")).toHaveCount(1);
  });
});

test.describe.serial("picker-iframe (cross-origin)", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("cross-origin.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("1. cross-origin iframe 내부 요소 선택·편집 → 해당 프레임 DOM 반영", async () => {
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();
    await pickElement(fixture, panel, "#title", { frame: "#xframe" });
    await expect(panel.getByTestId("repick")).toBeVisible();

    await typeStyleValue(panel, "color", "#00ff00");
    await expect(
      fixture.frameLocator("#xframe").locator("#title"),
    ).toHaveCSS("color", "rgb(0, 255, 0)");
  });

  test("2. top의 동일 selector(#title) 재선택 → 별개 요소로 분리 + iframe 카드만 출처 배지", async () => {
    // cross-origin.html top에도 h1#title이 있다 — 동일 selector가 프레임 축으로 갈리는 케이스.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#title");

    await typeStyleValue(panel, "width", "250px");
    await expect(fixture.locator("#title")).toHaveCSS("width", "250px");
    // iframe 편집은 top 편집에 오염되지 않고 유지.
    await expect(
      fixture.frameLocator("#xframe").locator("#title"),
    ).toHaveCSS("color", "rgb(0, 255, 0)");

    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    // 복합키가 깨지면 iframe 버퍼가 top 선택으로 승격돼 카드가 1장으로 붕괴한다.
    await expect(panel.getByTestId("changes-card")).toHaveCount(2);
    // 출처 배지는 cross-origin iframe 카드에만 — localhost 호스트 표기.
    await expect(panel.getByTestId("origin-badge")).toHaveCount(1);
    await expect(panel.getByTestId("origin-badge")).toContainText("localhost");
  });

  test("3. 버퍼(cross-origin) 행 초기화 → cross-origin 프레임 DOM 원복", async () => {
    const bufferedRow = panel
      .locator('[data-testid="changes-card"][data-source="buffered"]')
      .locator('[data-testid="changes-row"][data-prop="color"]');
    await bufferedRow.getByTestId("reset-row").click();

    await expect(
      fixture.frameLocator("#xframe").locator("#title"),
    ).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(panel.getByTestId("changes-card")).toHaveCount(1);
  });
});

// 오버레이의 프레임 소유 축 — top 전용(배너)과 프레임 로컬(라벨)이 갈린다.
// 좌표 계산은 overlay-layout 유닛이 잡지만 "실제로 어느 프레임에 무엇이 그려지는가"는 여기가 유일한 그물이다
// (overlay.ts·picker.ts는 커버리지 로직 스코프 제외).
test.describe.serial("picker-iframe (프레임 소유 오버레이)", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("iframe-narrow.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();
    // picker.start broadcast로 top·자식 양쪽에 overlay가 깔릴 때까지.
    await expect.poll(() => overlayInTop(fixture)).toBe(true);
    await expect.poll(() => overlayInFrame(fixture, /narrow-child\.html/)).toBe(true);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("1. 뷰포트 배너는 top 프레임에만 — 전 프레임 통틀어 1개", async () => {
    const top = await bannerIn(fixture);
    expect(top.count).toBe(1);
    const expected = await fixture.evaluate(
      () => `${window.innerWidth} × ${window.innerHeight}`,
    );
    expect(top.text).toBe(expected);

    const child = fixture.frame({ url: /narrow-child\.html/ });
    expect(child).not.toBeNull();
    // 자식이 자기 뷰포트 크기를 그리면 값이 둘이 되고, 좁은 iframe에선 콘텐츠를 통째로 가린다.
    expect((await bannerIn(child!)).count).toBe(0);

    const totals = await Promise.all(fixture.frames().map((f) => bannerIn(f)));
    expect(totals.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  test("2. 좁은 프레임 안 hover 라벨이 프레임을 넘지 않는다", async () => {
    const child = fixture.frame({ url: /narrow-child\.html/ });
    expect(child).not.toBeNull();

    const target = fixture.frameLocator("#narrow").locator("#chip");
    const box = await target.boundingBox();
    if (!box) throw new Error("#chip의 boundingBox 없음");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 첫 mousemove가 top blocker 핸드오프를 트리거하고 그 다음 이동이 자식 picker에 닿는다.
    let label: LabelBox | null = null;
    await expect(async () => {
      await fixture.mouse.move(cx - 2, cy - 2);
      await fixture.mouse.move(cx, cy);
      await fixture.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      label = await labelBoxIn(child!);
      expect(label).not.toBeNull();
    }).toPass({ timeout: 15000 });

    const box2 = label as unknown as LabelBox;
    // 전제 — 제약을 풀면 라벨이 프레임보다 넓다. 이게 깨지면(픽스처가 넓어지면) 폭 접기가
    // 발동하지 않아 아래 단언이 조용히 green이 된다.
    expect(box2.naturalW).toBeGreaterThan(box2.vpW);

    expect(box2.left).toBeGreaterThanOrEqual(0);
    expect(box2.right).toBeLessThanOrEqual(box2.vpW);
    expect(box2.width).toBeLessThanOrEqual(box2.vpW);
  });
});
