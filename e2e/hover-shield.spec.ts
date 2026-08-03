import type { Page } from "@playwright/test";

import {
  enterDebugAndPick,
  expect,
  pickElement,
  test,
} from "./fixtures/extension";

const FIXTURE_URL = "http://127.0.0.1/basic.html";
const HOST_ID = "__bugshot_picker_host";

// 방패는 open shadow root 안에 있다 — host를 통해 그대로 읽는다(recording-annotation과 같은 경로).
async function shieldShown(fixture: Page): Promise<boolean> {
  return fixture.evaluate((hostId) => {
    const host = document.getElementById(hostId);
    const el = host?.shadowRoot?.querySelector(".hover-shield") as
      | HTMLElement
      | null;
    if (!el) return false;
    return getComputedStyle(el).display !== "none";
  }, HOST_ID);
}

// picking hover 아웃라인(renderOutline이 켜는 파란 테두리 rect)이 떠 있나.
async function outlineShown(fixture: Page): Promise<boolean> {
  return fixture.evaluate((hostId) => {
    const host = document.getElementById(hostId);
    const rect = host?.shadowRoot?.querySelector(
      'rect[stroke="#2563eb"]',
    ) as SVGRectElement | null;
    if (!rect) return false;
    return rect.style.display !== "none" && Number(rect.getAttribute("width")) > 0;
  }, HOST_ID);
}

// 회귀의 판정축 그 자체 — 커서 밑 페이지 요소가 CSS :hover를 받고 있나.
async function pageHovered(fixture: Page, selector: string): Promise<boolean> {
  return fixture.evaluate(
    (sel) => document.querySelector(sel)?.matches(":hover") ?? false,
    selector,
  );
}

test.describe.serial("hover shield", () => {
  let fixture: Page;
  let panel: Page;
  let tabId: number;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    tabId = await ext.fixtureTabId(FIXTURE_URL);
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  // 커밋 직후~캡처 구간엔 blocker가 없다(selected 모드는 display:none, 캡처 준비는 host
  // visibility:hidden). 그 창을 방패가 메우는지를 캡처 준비 메시지로 결정적으로 재현한다 —
  // 커밋 직후의 실제 창은 사이드패널 왕복 타이밍이라 폴링으로는 공허해진다.
  test("캡처 준비 중에는 커서 밑 요소가 hover를 못 받는다", async ({ ext }) => {
    await fixture.bringToFront();
    await enterDebugAndPick(fixture, panel, "#el1");

    // 대조군: 방패가 내려간 평시엔 커서가 요소 위에 있고 hover도 살아 있다. 이게 false면
    // 아래 단언이 "커서가 딴 데 있어서" 통과하는 공허한 테스트가 된다.
    await expect
      .poll(() => pageHovered(fixture, "#el1"), { timeout: 10_000 })
      .toBe(true);
    expect(await shieldShown(fixture)).toBe(false);

    const prep = await ext.evalInExt(
      ([id]) =>
        chrome.tabs.sendMessage(id as number, { type: "picker.prepareCapture" }),
      [tabId],
    );
    expect(prep).toBeTruthy();

    // host가 visibility:hidden인데도 방패만은 hit target으로 남아야 한다.
    expect(await shieldShown(fixture)).toBe(true);
    expect(await pageHovered(fixture, "#el1")).toBe(false);

    await ext.evalInExt(
      ([id]) =>
        chrome.tabs.sendMessage(id as number, { type: "picker.endCapture" }),
      [tabId],
    );

    expect(await shieldShown(fixture)).toBe(false);
    await expect
      .poll(() => pageHovered(fixture, "#el1"), { timeout: 5_000 })
      .toBe(true);
  });

  // 방패와 blocker는 같은 shadow root의 hit target을 나눠 갖는다 — 커밋 방패가 남은 채
  // picking을 다시 열면 elementFromPoint가 우리 host를 돌려줘 클릭이 통째로 무시된다
  // (아웃라인도 안 뜨고 선택도 안 된다 — 에러 없이 조용히).
  //
  // 그 상태를 결정적으로 만든다: 패널의 prepareCapture를 삼켜 캡처가 영영 안 오게 하면
  // selection-commit 이유가 만료(1.5s)까지 남는다. 사이드패널이 before 캡처를 건너뛰는
  // 실사용 경로(버퍼된 요소 재선택)와 같은 상태다.
  test("커밋 방패가 남은 채로 다시 picking해도 선택이 된다", async () => {
    await fixture.bringToFront();
    await panel.evaluate(() => {
      const api = chrome.tabs as unknown as {
        sendMessage: (...args: unknown[]) => Promise<unknown>;
      };
      const orig = api.sendMessage.bind(chrome.tabs);
      api.sendMessage = (...args: unknown[]) => {
        const msg = args[1] as { type?: string } | undefined;
        if (msg?.type === "picker.prepareCapture") return Promise.resolve(undefined);
        return orig(...args);
      };
    });

    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#el3");
    await expect(panel.getByTestId("repick")).toBeVisible();
    // 전제 확인 — 캡처가 안 왔으니 방패가 아직 서 있어야 이 테스트가 공허하지 않다.
    expect(await shieldShown(fixture)).toBe(true);

    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();

    // 클릭이 아니라 hover 아웃라인으로 판정한다 — 클릭은 `pickElement`가 재시도로 감싸는데,
    // 그 재시도가 방패 만료(1.5s)를 넘겨 회귀를 대신 복구해버린다. **만료보다 짧은 창**에서
    // 아웃라인이 뜨는지를 봐야 방패가 hit target을 훔치는 회귀가 드러난다.
    const box = await fixture.locator("#el2").boundingBox();
    if (!box) throw new Error("#el2 boundingBox 없음");
    await fixture.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => outlineShown(fixture), { timeout: 1_000, intervals: [50] })
      .toBe(true);

    await pickElement(fixture, panel, "#el2");
    await expect(panel.getByTestId("repick")).toBeVisible();

    await panel.reload();
  });
});
