import type { Page } from "@playwright/test";
import {
  enterDebug,
  enterDebugAndPick,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// 본문 구성 순서 변경 — 설정에서 섹션 순서를 바꾸면 draft 본문까지 상속된다.
// 마우스 드래그는 Playwright 합성 입력이 실제 포인터 거동을 재현 못 해 flaky하므로
// (GOTCHAS "pointer capture") 판정은 전부 dnd-kit 키보드 재정렬로 한다.
// 설정은 chrome.storage에 영속돼 후행 spec까지 새므로 항상 finally에서 순서를 복원한다.

const DEFAULT_ORDER = [
  "description",
  "stepsToReproduce",
  "media",
  "expectedResult",
  "notes",
];

async function openIssueSettings(panel: Page) {
  // hydration 전 클릭 유실 — 다른 spec과 같은 클릭+active 폴링으로 흡수.
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
  await panel.getByTestId("settings-sub-issue").click();
  await expect(panel.getByTestId("issue-section-row-media")).toBeVisible();
}

async function readOrder(panel: Page): Promise<string[]> {
  return panel
    .locator('[data-testid^="issue-section-row-"]')
    .evaluateAll((els) =>
      els.map((el) =>
        (el as HTMLElement).dataset.testid!.replace("issue-section-row-", ""),
      ),
    );
}

// 핸들 포커스 → Space(집기) → 방향키 → Space(놓기). dnd-kit KeyboardSensor 경로.
// 키를 연속으로 쏘면 dnd-kit이 프레임을 못 넘겨 이동이 유실되므로 매 단계를 신호로 동기화한다:
// 집기 = 핸들 aria-pressed, 이동 = 행 인라인 transform이 0이 아님, 드롭 = 커밋된 순서.
// live region 문구는 쓰지 않는다 — 집기 안내와 이동 안내가 둘 다 갱신이라 어느 쪽에
// 만족했는지 구분이 안 되고(이동 전 드롭 레이스), 문구 자체도 로케일 비결정이다.
const rowTransform = (panel: Page, id: string) =>
  panel
    .getByTestId(`issue-section-row-${id}`)
    .evaluate((el) => (el as HTMLElement).style.transform);

// 드롭이 끝나면 dnd-kit이 인라인 transform을 걷어간다. 그 전에 다음 제스처를 시작하면
// 직전 드래그의 잔여 transform이 아래 게이트들을 즉시 통과시켜(센서는 armed 안 된 채)
// 빈 제스처가 나간다 — 매 스텝을 idle에서 출발시킨다.
async function waitRowIdle(panel: Page, id: string) {
  await expect(async () => {
    expect(await rowTransform(panel, id)).toBe("");
  }).toPass({ timeout: 5000 });
}

// 한 번의 집기-이동-놓기. 키가 유실될 수 있어 결과는 호출자가 검증한다.
async function keyboardDragOnce(panel: Page, id: string, key: "ArrowUp" | "ArrowDown") {
  const handle = panel.getByTestId(`issue-section-handle-${id}`);

  await waitRowIdle(panel, id);
  await handle.focus();
  await panel.keyboard.press("Space");
  // 집기 완료 = aria-pressed + 행에 인라인 transform이 깔림(센서 armed).
  // armed 전에 방향키를 쏘면 조용히 유실된다.
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(async () => {
    expect(await rowTransform(panel, id)).not.toBe("");
  }).toPass({ timeout: 5000 });

  await panel.keyboard.press(key);
  // 이동 반영 = transform이 0이 아님.
  await expect(async () => {
    expect(await rowTransform(panel, id)).not.toMatch(/translate3d\(0px, 0px/);
  }).toPass({ timeout: 5000 });

  await panel.keyboard.press("Space");
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  await waitRowIdle(panel, id);
}

async function moveOneStep(panel: Page, id: string, key: "ArrowUp" | "ArrowDown") {
  const before = await readOrder(panel);
  const idx = before.indexOf(id);
  const target = key === "ArrowUp" ? idx - 1 : idx + 1;
  expect(target).toBeGreaterThanOrEqual(0);
  expect(target).toBeLessThan(before.length);

  const expected = [...before];
  expected.splice(idx, 1);
  expected.splice(target, 0, id);

  // 커밋된 순서가 유일한 진실. 드롭 직후 한 번만 읽으면 리렌더 전이라 "유실"로 오판해
  // 제스처를 또 쏘고 원위치시킨다 — 반드시 폴링하고, 정말 안 왔을 때만 다시 시도한다.
  for (let attempt = 0; attempt < 3; attempt++) {
    await keyboardDragOnce(panel, id, key);
    try {
      await expect(async () => {
        expect(await readOrder(panel)).toEqual(expected);
      }).toPass({ timeout: 3000 });
      return;
    } catch {
      // 아무것도 커밋 안 된 경우만 재시도 대상. 엉뚱한 순서면 그대로 실패시킨다.
      expect(await readOrder(panel)).toEqual(before);
    }
  }
  throw new Error(`키보드 재정렬이 커밋되지 않음: ${id} ${key}`);
}

async function moveByKeyboard(
  panel: Page,
  id: string,
  key: "ArrowUp" | "ArrowDown",
  times = 1,
) {
  for (let i = 0; i < times; i++) await moveOneStep(panel, id, key);
}

async function restoreDefaultOrder(panel: Page) {
  const reset = panel.getByTestId("reset-body-composition");
  if (await reset.isEnabled()) await reset.click();
  await expect(async () => {
    expect(await readOrder(panel)).toEqual(DEFAULT_ORDER);
  }).toPass();
}

test("키보드로 미디어 카드를 맨 위로 옮기면 순서가 바뀌고 새로고침 후에도 유지된다", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  try {
    await openIssueSettings(panel);
    await restoreDefaultOrder(panel);

    // media(index 2) → 맨 위. ArrowUp 2회.
    await moveByKeyboard(panel, "media", "ArrowUp", 2);
    expect(await readOrder(panel)).toEqual([
      "media",
      "description",
      "stepsToReproduce",
      "expectedResult",
      "notes",
    ]);

    // 영속 확인 — 패널을 새로 띄워도 순서가 남는다.
    await panel.reload();
    await openIssueSettings(panel);
    expect(await readOrder(panel)).toEqual([
      "media",
      "description",
      "stepsToReproduce",
      "expectedResult",
      "notes",
    ]);
  } finally {
    await openIssueSettings(panel);
    await restoreDefaultOrder(panel);
    await panel.close();
    await fixture.close();
  }
});

test("미디어 행에는 사용 여부 스위치가 없고, 기타 섹션에 재현 채우기·파일 첨부가 있다", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  try {
    await openIssueSettings(panel);

    // 스위치 id는 issue-section-${id} — 미디어만 없다(핸들은 있다).
    await expect(panel.locator('[id="issue-section-media"]')).toHaveCount(0);
    await expect(panel.getByTestId("issue-section-handle-media")).toBeVisible();
    for (const id of ["description", "stepsToReproduce", "expectedResult", "notes"]) {
      await expect(panel.locator(`[id="issue-section-${id}"]`)).toHaveCount(1);
    }

    // 파일 첨부·재현 과정 채우기는 본문 구성이 아니라 기타 섹션에 있다.
    const other = panel.getByTestId("settings-section-other");
    const body = panel.getByTestId("settings-section-body-composition");
    await expect(other.locator('[id="setting-auto-repro-prefill"]')).toHaveCount(1);
    await expect(other.locator('[id="setting-attachments-enabled"]')).toHaveCount(1);
    await expect(body.locator('[id="setting-attachments-enabled"]')).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test("복원 버튼은 기본 순서면 비활성, 순서를 바꾸면 활성이고 순서만 되돌린다", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);
  const notes = panel.locator('[id="issue-section-notes"]');

  try {
    await openIssueSettings(panel);
    await restoreDefaultOrder(panel);
    const reset = panel.getByTestId("reset-body-composition");
    await expect(reset).toBeDisabled();

    // 사용 여부는 복원 대상이 아니다 — notes를 켜 두고 순서만 되돌아오는지 본다.
    await notes.click();
    await expect(notes).toHaveAttribute("data-state", "checked");
    await expect(reset).toBeDisabled(); // enabled 변경은 순서가 아니다

    await moveByKeyboard(panel, "notes", "ArrowUp");
    await expect(reset).toBeEnabled();

    await reset.click();
    await expect(async () => {
      expect(await readOrder(panel)).toEqual(DEFAULT_ORDER);
    }).toPass();
    await expect(reset).toBeDisabled();
    await expect(notes).toHaveAttribute("data-state", "checked");
  } finally {
    if ((await notes.getAttribute("data-state")) === "checked") await notes.click();
    await restoreDefaultOrder(panel);
    await panel.close();
    await fixture.close();
  }
});

test("설정 순서가 draft·preview 본문에 그대로 상속된다 (기본 순서 대조 → 재정렬)", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  // 미디어 블록 vs 발생 현상 섹션의 DOM 선후로 판정. 두 표면 모두 같은 방식.
  const draftBlocks = panel.locator(
    '[data-testid="draft-media-block"], [data-testid="draft-section-description"]',
  );
  const previewBlocks = panel.locator(
    '[data-testid="preview-media-block"], [data-testid="preview-section-description"]',
  );

  try {
    await openIssueSettings(panel);
    await restoreDefaultOrder(panel);

    // element 모드로 drafting 진입 — 스타일 diff가 미디어 슬롯에 렌더된다.
    await enterDebugAndPick(fixture, panel, "#title");
    await typeStyleValue(panel, "color", "#ff0000");
    const next = panel.getByTestId("next-step");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await panel.getByTestId("draft-title").fill("Body composition order e2e");

    // 대조군 — 기본 순서에서는 발생 현상이 미디어보다 먼저다.
    // 이게 없으면 "미디어가 늘 위"여도 아래 단언이 통과해 인과가 증명되지 않는다.
    await expect(draftBlocks.first()).toHaveAttribute(
      "data-testid",
      "draft-section-description",
    );

    await expect(panel.getByTestId("to-preview")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await panel.getByTestId("to-preview").click();
    await expect(previewBlocks.first()).toHaveAttribute(
      "data-testid",
      "preview-section-description",
    );

    // 같은 세션을 유지한 채 설정에서 미디어를 맨 위로.
    await openIssueSettings(panel);
    await moveByKeyboard(panel, "media", "ArrowUp", 2);
    expect((await readOrder(panel))[0]).toBe("media");

    // 프리뷰·draft 양쪽이 새 순서를 따라 뒤집힌다(store 파생 — 재캡처 불필요).
    await enterDebug(panel);
    await expect(previewBlocks.first()).toHaveAttribute(
      "data-testid",
      "preview-media-block",
    );
    await panel.getByTestId("back-to-draft").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(draftBlocks.first()).toHaveAttribute(
      "data-testid",
      "draft-media-block",
    );
  } finally {
    await openIssueSettings(panel);
    await restoreDefaultOrder(panel);
    await panel.close();
    await fixture.close();
  }
});
