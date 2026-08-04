import type { Locator, Page } from "@playwright/test";

import {
  enterDebugAndPick,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";

const FIXTURE_URL = "http://127.0.0.1/basic.html";

// 시나리오를 3개로 묶고 캡처를 beforeAll 1회로 제한한다. 캡처를 진입로로 쓰는 spec 5개가
// captureVisibleTab cold-start + 확장 전역 quota로 전멸한 전례가 있다(GOTCHAS).
// Konva Stage는 단일 <canvas>라 "그림이 맞나"는 판정 불가 — `img src` 문자열의 **변화 여부**와
// 액션 버튼 개수로만 판정한다.

// pick 직후 자동 발행되는 before 캡처가 background 직렬 큐를 빠져나올 때까지 fixture를 앞에 둔다.
// 놓치면 before 기준이 조용히 사라지고 증상이 구현 회귀와 구별되지 않는다.
async function settleBeforeCapture(fixture: Page): Promise<void> {
  await fixture.bringToFront();
  await fixture.waitForTimeout(1500);
}

// [다음]은 aria-disabled+클릭 가드라 actionability가 막지 않는다 — 부재 단언이 필수.
// 캡처 관문이 tab.active를 재확인하므로 fixture를 앞에 두고 evaluate 클릭한다.
async function proceedToDrafting(panel: Page, fixture: Page): Promise<void> {
  const next = panel.getByTestId("next-step");
  const drafting = panel.getByTestId("drafting-panel");
  await expect(async () => {
    if (!(await drafting.isVisible())) {
      await expect(next).not.toHaveAttribute("aria-disabled", "true");
      await fixture.bringToFront();
      await next.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(drafting).toBeVisible({ timeout: 2500 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });
}

// 액션 그룹은 hover/focus에서만 조건부 렌더된다(opacity-0이 아니라 DOM 부재).
// 카드는 이미지의 부모다.
function snapshotCard(panel: Page, which: "before" | "after"): Locator {
  return panel.getByTestId(`snapshot-${which}`).locator("xpath=..");
}

async function revealActions(panel: Page, which: "before" | "after"): Promise<void> {
  await snapshotCard(panel, which).hover();
  await expect(panel.getByTestId("diff-image-annotate")).toBeVisible();
}

async function imgSrc(panel: Page, which: "before" | "after"): Promise<string> {
  return (await panel.getByTestId(`snapshot-${which}`).getAttribute("src")) ?? "";
}

// 드래그는 선택이 아니라 전제다 — shapes가 0개면 [완료]가 disabled라 오버레이가 안 닫히고,
// 증상은 "원본과 같은 이미지"가 아니라 "오버레이가 안 닫힘"으로 나타난다.
// rect는 대각선으로 끌어 width·height 둘 다 0이 아니게 한다.
async function drawAndComplete(panel: Page): Promise<void> {
  const overlay = panel.getByTestId("diff-annotation-overlay");
  await expect(overlay).toBeVisible();
  // lazy 청크 로드 후 툴바 렌더 대기.
  await expect(panel.getByTestId("annotation-tool-rect")).toBeVisible();
  await panel.getByTestId("annotation-tool-rect").click();

  const canvas = overlay.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("diff annotation canvas boundingBox 없음");
  await panel.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await panel.mouse.down();
  await panel.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, {
    steps: 10,
  });
  await panel.mouse.up();

  const done = panel.getByTestId("annotation-done");
  await expect(done).toBeEnabled();
  await done.click();
  await expect(overlay).toBeHidden();
}

test.describe.serial("diff table 이미지 주석", () => {
  let fixture: Page;
  let panel: Page;
  let rawBefore: string;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);
    panel = await ext.openPanel(tabId);

    await enterDebugAndPick(fixture, panel, "#title", { keepFixtureActive: true });
    await settleBeforeCapture(fixture);
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(255, 0, 0)");

    await proceedToDrafting(panel, fixture);

    // before가 유실되면 아래 전부가 "주석이 안 붙음"으로 보인다 — 진입 조건을 먼저 못 박는다.
    await expect(panel.getByTestId("snapshot-before")).toBeVisible();
    rawBefore = await imgSrc(panel, "before");
    expect(rawBefore.length).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("주석 전에는 제거 버튼이 없고, 도형을 커밋해 완료하면 img src가 바뀌며 제거 버튼이 생긴다", async () => {
    await revealActions(panel, "before");
    await expect(panel.getByTestId("diff-image-reset")).toHaveCount(0);

    await panel.getByTestId("diff-image-annotate").click();
    await drawAndComplete(panel);

    await expect(panel.getByTestId("snapshot-before")).not.toHaveAttribute(
      "src",
      rawBefore,
    );
    await revealActions(panel, "before");
    await expect(panel.getByTestId("diff-image-reset")).toBeVisible();
  });

  test("제거를 누르면 img src가 주석 전 값으로 돌아가고 제거 버튼이 사라진다", async () => {
    await revealActions(panel, "before");
    await panel.getByTestId("diff-image-reset").click();

    await expect(panel.getByTestId("snapshot-before")).toHaveAttribute(
      "src",
      rawBefore,
    );
    await revealActions(panel, "before");
    await expect(panel.getByTestId("diff-image-reset")).toHaveCount(0);
  });

  test("preview의 diff table에는 액션 버튼이 없고 img src는 주석본이다", async () => {
    // 다시 주석해 미리보기로 넘길 주석본을 만든다.
    await revealActions(panel, "before");
    await panel.getByTestId("diff-image-annotate").click();
    await drawAndComplete(panel);
    const annotated = await imgSrc(panel, "before");
    expect(annotated).not.toBe(rawBefore);

    // titlePrefix가 비어 있으면 defaultTitle이 ""라 [이슈 미리보기]가 disabled로 남는다.
    await panel.getByTestId("draft-title").fill("Diff annotation");
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("preview-media-block").first()).toBeVisible();

    // 미리보기가 원본을 보여주고 제출물만 주석본이면 미리보기가 미리보기가 아니게 된다.
    await expect(panel.getByTestId("snapshot-before")).toHaveAttribute(
      "src",
      annotated,
    );
    // 읽기 전용 화면은 핸들러를 안 받으므로 hover해도 액션이 뜨지 않는다.
    await snapshotCard(panel, "before").hover();
    await expect(panel.getByTestId("diff-image-annotate")).toHaveCount(0);
    await expect(panel.getByTestId("diff-image-reset")).toHaveCount(0);
  });
});
