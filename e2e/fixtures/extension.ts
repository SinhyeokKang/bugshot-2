import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
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
      // 응답 본문 검색 e2e용 — 본문에만 마커 문자열을 담은 JSON(allowlist content-type이라
      // 레코더가 string variant로 캡처). 마커는 URL 경로엔 없어 "본문으로만 매칭"을 판정.
      if (urlPath.startsWith("/e2e-json")) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ note: "zqxbodyneedle" }));
        return;
      }
      const name = urlPath === "/" ? "basic.html" : urlPath.replace(/^\//, "");
      const file = path.join(PAGES_DIR, name);
      if (!file.startsWith(PAGES_DIR + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      readFile(file)
        .then((body) => {
          // .css는 text/css로 — text/html이면 Chrome이 strict MIME으로 stylesheet 거부.
          const type = name.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8";
          res.writeHead(200, { "content-type": type });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(404);
          res.end();
        });
    });
    // WebSocket 로그 e2e용 echo — `ws` 의존 없이 raw 핸드셰이크 + 텍스트 프레임 echo.
    // 클라이언트→서버 프레임은 항상 masked(unmask 후 텍스트 opcode만 echo, close면 종료).
    server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"];
      if (typeof key !== "string") {
        socket.destroy();
        return;
      }
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on("data", (buf: Buffer) => {
        let offset = 0;
        while (offset + 2 <= buf.length) {
          const b0 = buf[offset];
          const b1 = buf[offset + 1];
          const opcode = b0 & 0x0f;
          const masked = (b1 & 0x80) !== 0;
          let len = b1 & 0x7f;
          let p = offset + 2;
          if (len === 126) {
            len = buf.readUInt16BE(p);
            p += 2;
          } else if (len === 127) {
            len = Number(buf.readBigUInt64BE(p));
            p += 8;
          }
          let maskKey: Buffer | null = null;
          if (masked) {
            maskKey = buf.subarray(p, p + 4);
            p += 4;
          }
          const payload = buf.subarray(p, p + len);
          if (maskKey) {
            for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
          }
          if (opcode === 0x8) {
            socket.end();
            return;
          }
          if (opcode === 0x1 && len < 126) {
            // 텍스트 프레임 — 서버→클라이언트는 unmasked로 echo.
            socket.write(Buffer.concat([Buffer.from([0x81, len]), payload]));
          }
          offset = p + len;
        }
      });
      socket.on("error", () => {});
    });
    server.on("error", reject);
    // 포트 0(ephemeral) 바인딩 — 실포트를 fixtureUrl에 반영해 점유 충돌 원천 제거.
    // host 미지정(전 인터페이스) — localhost(::1 포함)로도 접속돼 cross-origin 재현에 쓴다
    // (127.0.0.1 vs localhost는 같은 서버지만 origin이 다르다 → origin 필터 spec).
    // trade-off: 테스트 동안 LAN 노출(정적 HTML + 경로 탈출 가드로 실위험 낮음),
    // macOS 방화벽 활성 시 최초 1회 수신 허용 프롬프트 가능.
    server.listen(0, () => {
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
        // 전역 기본 viewport — config.use.viewport는 persistent context엔 안 먹어 여기 직접 지정.
        // 사이드패널 폭에 근접해 좁은 폭 컨테이너 쿼리 리플로우를 재현.
        viewport: { width: 480, height: 720 },
        // 확장 SW가 headless에선 안 깨어나므로 headed 유지. 대신 창을 화면 밖으로
        // 보내 깜빡임·포커스 탈취를 없앤다(완전 백그라운드는 불가). 디버깅으로 창을
        // 보려면 E2E_SHOW=1.
        headless: false,
        args: [
          `--disable-extensions-except=${DIST_E2E}`,
          `--load-extension=${DIST_E2E}`,
          "--lang=ko",
          "--no-first-run",
          "--no-default-browser-check",
          ...(process.env.E2E_SHOW === "1"
            ? []
            : ["--window-position=-10000,-10000"]),
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
// expectSelection(기본 true): repick이 뜰 때까지 hover+click을 재시도한다. repick 클릭 직후
// 재arm 레이스(panel은 "repick 숨김"인데 content script picker가 아직 안 붙어 단발 클릭이 유실)로
// 인한 flaky를 막는다. 선택이 안 되는 픽(iframe 미지원 등)은 expectSelection:false로 1회만.
export async function pickElement(
  fixture: Page,
  panel: Page,
  selector: string,
  opts: { expectSelection?: boolean } = {},
): Promise<void> {
  const { expectSelection = true } = opts;
  await fixture.bringToFront();
  const clickOnce = async () => {
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
  };

  if (!expectSelection) {
    await clickOnce();
    await panel.bringToFront();
    return;
  }

  // 클릭이 picker 재arm 전에 떨어지면 유실되므로 repick 노출까지 재클릭(이미 선택됐으면
  // picker가 idle이라 추가 클릭은 무해 — 동일 요소 재선택은 idempotent).
  await expect(async () => {
    await clickOnce();
    await expect(panel.getByTestId("repick")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await panel.bringToFront();
}

// 디버그 탭 진입까지 — fresh 프로필은 연동 0개라 integrations 자동 전환 effect와 race가 난다.
// 클릭 후 active 단언을 폴링해 안정화한다. 캡처 진입 화면(mode-* 버튼)을 쓰는 모든 spec의 진입점.
export async function enterDebug(panel: Page): Promise<void> {
  await expect(async () => {
    await panel.getByTestId("tab-debug").click();
    await expect(panel.getByTestId("tab-debug")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
}

// 디버그 탭 진입 → element 모드 → 요소 선택까지의 공통 진입 시퀀스.
export async function enterDebugAndPick(
  fixture: Page,
  panel: Page,
  selector: string,
): Promise<void> {
  await enterDebug(panel);
  await panel.getByTestId("mode-element").click();
  await pickElement(fixture, panel, selector);
  await expect(panel.getByTestId("repick")).toBeVisible();
}

// prop 라벨 행 — section 스코프로 한정해 changes-dialog(포털) 행의 prop 텍스트와 strict mode 충돌 방지.
function propRow(panel: Page, label: string) {
  return panel.locator("section").getByText(label, { exact: true }).locator("..");
}

// 접힌 collapsible Section을 펼친다(접힌 섹션은 자식이 DOM에서 제거됨).
// probeLabel: 섹션 내부의 고유 prop 라벨(존재하면 이미 펼쳐진 것).
export async function ensureSectionOpen(
  panel: Page,
  toggleTestId: string,
  probeLabel: string,
): Promise<void> {
  const probe = panel.locator("section").getByText(probeLabel, { exact: true });
  if ((await probe.count()) === 0) {
    await panel.getByTestId(toggleTestId).click();
    await probe.first().waitFor();
  }
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

// QuadProp(margin/padding)·RadiusProp("radius")·GapPairProp("gap") — LinkToggle(=마지막 버튼)을
// 켜고 첫 칸에 입력해 전 면 동일값 커밋. shorthand collapse 기준값을 만든다.
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

// QuadProp 한 면만(unlink) 입력. idx: top0 right1 bottom2 left3 (gap: row0 column1). toggle=last.
export async function setQuadSideValue(
  panel: Page,
  label: string,
  idx: number,
  value: string,
): Promise<void> {
  const row = propRow(panel, label);
  const buttons = row.locator("button");
  const toggle = buttons.last();
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await buttons.nth(idx).click();
  await panel.locator("[cmdk-input]").fill(value);
  await closeAllPopovers(panel);
}

// SelectProp(shadcn Select) — 트리거 열고 옵션 텍스트로 선택.
export async function selectStyleValue(
  panel: Page,
  label: string,
  option: string,
): Promise<void> {
  await propRow(panel, label).getByRole("combobox").click();
  await panel.getByRole("option", { name: option, exact: true }).click();
}

// QuadStyleProp(border-style) — per-side Select 4개(role=combobox) + LinkToggle(last button).
// linked 켜고 첫 칸에서 옵션 선택해 전 면 일괄 적용.
export async function setQuadStyleLinkedValue(
  panel: Page,
  label: string,
  option: string,
): Promise<void> {
  const row = propRow(panel, label);
  const toggle = row.locator("button").last();
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await row.getByRole("combobox").first().click();
  await panel.getByRole("option", { name: option, exact: true }).click();
}

// QuadStyleProp 한 면만(unlink) 선택. idx: top0 right1 bottom2 left3.
export async function setQuadStyleSideValue(
  panel: Page,
  label: string,
  idx: number,
  option: string,
): Promise<void> {
  const row = propRow(panel, label);
  const toggle = row.locator("button").last();
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await row.getByRole("combobox").nth(idx).click();
  await panel.getByRole("option", { name: option, exact: true }).click();
}

// AlignmentProp(Tabs) — 인덱스: left0 center1 right2 justify3.
export async function setAlignment(
  panel: Page,
  label: string,
  idx: number,
): Promise<void> {
  await propRow(panel, label).getByRole("tab").nth(idx).click();
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
