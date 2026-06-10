import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_E2E = path.resolve(FIXTURES_DIR, "../../dist-e2e");
const PAGES_DIR = path.join(FIXTURES_DIR, "pages");

export interface ExtContext {
  context: BrowserContext;
  extensionId: string;
  fixtureUrl: (page: string) => string;
  fixtureTabId: (urlPattern?: string) => Promise<number>;
  openPanel: (tabId: number) => Promise<Page>;
}

function startFixtureServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0];
      const name = urlPath === "/" ? "basic.html" : urlPath.replace(/^\//, "");
      const file = path.join(PAGES_DIR, name);
      if (!file.startsWith(PAGES_DIR + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      readFile(file)
        .then((body) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(404);
          res.end();
        });
    });
    server.on("error", reject);
    // 포트 0(ephemeral) 바인딩 — 실포트를 fixtureUrl에 반영해 점유 충돌 원천 제거.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve({ server, port: addr.port });
      else reject(new Error("fixture server: 포트를 확인할 수 없음"));
    });
  });
}

export const test = base.extend<object, { ext: ExtContext }>({
  ext: [
    async ({}, use) => {
      if (!existsSync(path.join(DIST_E2E, "manifest.json"))) {
        throw new Error(
          "dist-e2e/manifest.json이 없습니다 — pnpm build:e2e를 먼저 실행하세요.",
        );
      }
      const { server, port } = await startFixtureServer();
      const userDataDir = await mkdtemp(path.join(tmpdir(), "bugshot-e2e-"));
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
          `--disable-extensions-except=${DIST_E2E}`,
          `--load-extension=${DIST_E2E}`,
          "--lang=ko",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });
      // waitForEvent는 SW를 깨우지 못한다 — idle 종료 후 호출하면 타임아웃까지 hang. 기동 직후에만 호출할 것.
      const getSw = async (): Promise<Worker> => {
        const [sw] = context.serviceWorkers();
        return sw ?? (await context.waitForEvent("serviceworker"));
      };
      const extensionId = new URL((await getSw()).url()).host;

      const ext: ExtContext = {
        context,
        extensionId,
        fixtureUrl: (page) => `http://127.0.0.1:${port}/${page}`,
        // 기본 패턴은 fixture 서버 호스트 — chrome match pattern은 포트를 무시한다.
        fixtureTabId: async (urlPattern = "http://127.0.0.1/*") => {
          const sw = await getSw();
          const tabs = await sw.evaluate(
            (pattern: string) => chrome.tabs.query({ url: pattern }),
            urlPattern,
          );
          const id = tabs[0]?.id;
          if (id == null) throw new Error(`fixture 탭 없음: ${urlPattern}`);
          return id;
        },
        openPanel: async (tabId) => {
          const panel = await context.newPage();
          await panel.goto(
            `chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`,
          );
          return panel;
        },
      };

      await use(ext);

      await context.close();
      server.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});

export const expect = test.expect;

// picker 선택 — blocker(overlay) 경유 bbox 중심 클릭. hover로 하이라이트를 먼저 유도한다.
export async function pickElement(
  fixture: Page,
  panel: Page,
  selector: string,
): Promise<void> {
  await fixture.bringToFront();
  const box = await fixture.locator(selector).boundingBox();
  if (!box) throw new Error(`pickElement: ${selector}의 boundingBox 없음`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await fixture.mouse.move(cx, cy);
  // double rAF — picker 오버레이가 hover 타깃을 반영할 시간을 준다 (PoC 실측).
  await fixture.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await fixture.mouse.click(cx, cy);
  await panel.bringToFront();
}

// 디버그 탭 진입 → element 모드 → 요소 선택까지의 공통 진입 시퀀스.
export async function enterDebugAndPick(
  fixture: Page,
  panel: Page,
  selector: string,
): Promise<void> {
  // fresh 프로필은 연동 0개 → integrations 자동 전환 effect와 race — 클릭 후 active 단언을 폴링.
  await expect(async () => {
    await panel.getByTestId("tab-debug").click();
    await expect(panel.getByTestId("tab-debug")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
  await panel.getByTestId("mode-element").click();
  await pickElement(fixture, panel, selector);
  await expect(panel.getByTestId("repick")).toBeVisible();
}

// prop 라벨 행 — section 스코프로 한정해 changes-dialog(포털) 행의 prop 텍스트와 strict mode 충돌 방지.
function propRow(panel: Page, label: string) {
  return panel.locator("section").getByText(label, { exact: true }).locator("..");
}

// ValueCombobox 팝오버 열기 → cmdk input fill → 닫기. label은 i18n을 타지 않는 CSS prop 라벨.
export async function typeStyleValue(
  panel: Page,
  label: string,
  value: string,
): Promise<void> {
  const row = propRow(panel, label);
  await row.locator("button").first().click();
  await panel.locator("[cmdk-input]").fill(value);
  await closeAllPopovers(panel);
}

// QuadProp(margin/padding 등) — LinkToggle을 켜고 첫 칸에 입력해 4면 동일값 커밋.
export async function setQuadLinkedValue(
  panel: Page,
  label: string,
  value: string,
): Promise<void> {
  const row = propRow(panel, label);
  const buttons = row.locator("button");
  const toggle = buttons.last();
  const linked = (await toggle.getAttribute("aria-pressed")) === "true";
  if (!linked) await toggle.click();
  await buttons.first().click();
  await panel.locator("[cmdk-input]").fill(value);
  await closeAllPopovers(panel);
}

// Escape가 중첩 팝오버에서 간헐 무시됨(PoC 실측) — 잔존 시 outside click 폴백, 최대 4회.
export async function closeAllPopovers(panel: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if ((await openPopoverCount(panel)) === 0) return;
    await panel.keyboard.press("Escape");
    await panel.waitForTimeout(100);
    if ((await openPopoverCount(panel)) === 0) return;
    await panel.mouse.click(2, 2);
    await panel.waitForTimeout(100);
  }
  // 잔존 팝오버는 후속 클릭을 가로채 원인 불명 실패로 전이 — 조용히 넘기지 않는다.
  if ((await openPopoverCount(panel)) > 0)
    throw new Error("closeAllPopovers: 4회 시도 후에도 팝오버가 닫히지 않음");
}

function openPopoverCount(panel: Page): Promise<number> {
  return panel.locator("[data-radix-popper-content-wrapper]").count();
}
