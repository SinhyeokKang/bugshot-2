import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";
import { openSettings, setScreenLocale } from "./fixtures/settings";
import type { LocaleMode } from "../src/i18n/locales";

// 녹화 중 로그 확인 — 녹화 중에도 콘솔·네트워크 서브탭이 열리고, 로그 서브탭에 반전 플로팅 바가 뜬다.
//
// 실 tabCapture는 자동화가 불안정해(capture.spec 주석) 화면 녹화 경로를 탄다. 패널 페이지의
// getDisplayMedia를 canvas.captureStream()으로 stub하면 picker 없이 실제 MediaRecorder 세션이 돈다
// (stub은 panel.evaluate로 심는다 — 녹화 버튼이 클릭 시점에 읽으므로 부팅 후 덮어도 반영).
// 탭 녹화 실경로·OS 테마 전환·reduced motion·화면 녹화 중 탭 이동은 수동 잔여(COVERAGE.md).
//
// worker fixture가 프로필을 공유하므로 녹화 방식·테마·로케일은 afterAll/finally로 원래 값에 되돌린다
// (GOTCHAS "설정 영속 오염").

const LOCALE_LABELS: Record<LocaleMode, string> = {
  ko: "한국어", en: "English", fr: "Français", es: "Español", de: "Deutsch",
};

const THEME_ICONS = { light: "svg.lucide-sun", dark: "svg.lucide-moon", system: "svg.lucide-monitor" } as const;
type Theme = keyof typeof THEME_ICONS;

test.describe.serial("recording-live-logs: 녹화 중 로그 서브탭", () => {
  let fixture: Page;
  let panel: Page;
  let originalMode: "tab" | "screen" = "tab";

  const bar = () => panel.getByTestId("recording-bar");
  const activeSub = () => panel.locator('[data-testid^="subtab-"][data-state="active"]');

  async function stubDisplayMedia() {
    await panel.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext("2d")!;
        const paint = () => {
          ctx.fillStyle = `hsl(${(performance.now() / 4) % 360},70%,50%)`;
          ctx.fillRect(0, 0, 320, 240);
        };
        paint();
        setInterval(paint, 100);
        const stream = canvas.captureStream(12);
        (window as unknown as { __stubStream: MediaStream }).__stubStream = stream;
        return stream;
      };
    });
  }

  async function startRecording() {
    await enterDebug(panel);
    await panel.getByTestId("subtab-issue").click();
    await panel.getByTestId("mode-record").click();
    // 녹화 진입 = 진입 화면이 RecordingState로 바뀐다. 로그 서브탭 활성은 이 기능의 단언이라 여기서 보지 않는다.
    await expect(panel.getByTestId("mode-record")).toHaveCount(0);
  }

  async function seedConsoleLog() {
    await fixture.evaluate(() => console.log("rll-seed"));
    await expect(panel.locator("[data-entry-id]").first()).toBeVisible({ timeout: 15_000 });
  }

  async function closeTrim() {
    await panel.getByTestId("replay-trim-cancel").click();
    await panel.getByTestId("replay-trim-cancel-confirm").click();
    await expect(panel.getByTestId("replay-trim-overlay")).toHaveCount(0);
  }

  // 실패한 케이스가 녹화·트림을 남기면 다음 케이스의 진입이 막힌다 — idle로 되돌린다.
  async function resetToIdle() {
    if (await panel.getByTestId("replay-trim-overlay").isVisible()) await closeTrim();
    const consoleTrigger = panel.getByTestId("subtab-console");
    if ((await consoleTrigger.isVisible()) && (await consoleTrigger.isEnabled())) {
      await consoleTrigger.click();
      if (await bar().isVisible()) await panel.getByTestId("recording-bar-cancel").click();
      await expect(bar()).toHaveCount(0);
    }
    await panel.getByTestId("subtab-issue").click();
  }

  async function lum(selector: string): Promise<number> {
    return panel.evaluate((sel) => {
      const color = getComputedStyle(document.querySelector(sel)!).backgroundColor;
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }, selector);
  }

  async function currentTheme(): Promise<Theme> {
    await openSettings(panel, "general");
    const trigger = panel.getByTestId("settings-theme");
    for (const [theme, icon] of Object.entries(THEME_ICONS) as [Theme, string][]) {
      if (await trigger.locator(icon).count()) return theme;
    }
    throw new Error("theme trigger has no known icon");
  }

  async function setTheme(theme: Theme) {
    await openSettings(panel, "general");
    const trigger = panel.getByTestId("settings-theme");
    if (await trigger.locator(THEME_ICONS[theme]).count()) return;
    await trigger.click();
    // 옵션 라벨은 i18n이라 로케일 비결정 — 아이콘으로 고른다(GOTCHAS "locale 비결정").
    await panel.getByRole("option").filter({ has: panel.locator(THEME_ICONS[theme]) }).click();
    await expect(trigger.locator(THEME_ICONS[theme])).toHaveCount(1);
  }

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    panel = await ext.openPanel(await ext.fixtureTabId());
    await openSettings(panel, "issue");
    originalMode =
      (await panel.getByTestId("recording-mode-screen").getAttribute("data-state")) === "active" ? "screen" : "tab";
    await panel.getByTestId("recording-mode-screen").click();
    await expect(panel.getByTestId("recording-mode-screen")).toHaveAttribute("data-state", "active");
    await stubDisplayMedia();
  });

  test.afterEach(async () => {
    await resetToIdle();
  });

  test.afterAll(async () => {
    await openSettings(panel, "issue");
    await panel.getByTestId(`recording-mode-${originalMode}`).click();
    await panel.close();
    await fixture.close();
  });

  test("녹화를 시작하면 로그 서브탭이 열리고, 바는 로그 서브탭에만 뜬다", async () => {
    await startRecording();
    await expect(panel.getByTestId("subtab-console")).toBeEnabled();
    await expect(panel.getByTestId("subtab-network")).toBeEnabled();

    await panel.getByTestId("subtab-console").click();
    await expect(bar()).toBeVisible();
    await panel.getByTestId("subtab-network").click();
    await expect(bar()).toBeVisible();
    await panel.getByTestId("subtab-issue").click();
    await expect(activeSub()).toHaveAttribute("data-testid", "subtab-issue");
    await expect(bar()).toHaveCount(0);
  });

  test("녹화 중이면 콘솔 footer의 [Clear]·[이슈 작성]이 disabled다", async () => {
    await startRecording();
    await panel.getByTestId("subtab-console").click();
    // 0건이면 Clear는 원래 disabled라 단언이 공허하다 — 녹화 중에 쌓인 로그 1건 이상을 먼저 확인한다.
    await seedConsoleLog();
    await expect(panel.getByTestId("console-clear")).toBeDisabled();
    await expect(panel.getByTestId("console-write-issue")).toBeDisabled();
  });

  test("콘솔 서브탭에서 바의 [완료]를 누르면 트림이 뜨고, 트림을 닫으면 issue 서브탭이다", async () => {
    await startRecording();
    await panel.getByTestId("subtab-console").click();
    await expect(bar()).toBeVisible();
    await panel.waitForTimeout(1000); // MediaRecorder가 첫 청크를 낼 시간 — 0바이트 영상 경로는 이 spec의 대상이 아니다
    await panel.getByTestId("recording-bar-stop").click();
    await expect(panel.getByTestId("replay-trim-overlay")).toBeVisible({ timeout: 15_000 });
    await closeTrim();
    await expect(activeSub()).toHaveAttribute("data-testid", "subtab-issue");
  });

  test("콘솔 서브탭에서 바의 [✕]를 누르면 바가 사라지고 콘솔에 머물며 [Clear]가 다시 활성이다", async () => {
    await startRecording();
    await panel.getByTestId("subtab-console").click();
    await seedConsoleLog();
    await expect(panel.getByTestId("console-clear")).toBeDisabled();

    await panel.getByTestId("recording-bar-cancel").click();
    await expect(bar()).toHaveCount(0);
    await expect(activeSub()).toHaveAttribute("data-testid", "subtab-console");
    await expect(panel.getByTestId("console-clear")).toBeEnabled();
  });

  test("화면 공유가 끊기면(track ended) 트림이 뜬다", async () => {
    await startRecording();
    await panel.getByTestId("subtab-console").click();
    await expect(bar()).toBeVisible();
    await panel.waitForTimeout(1000);
    await panel.evaluate(() => {
      const stream = (window as unknown as { __stubStream: MediaStream }).__stubStream;
      stream.getVideoTracks()[0].dispatchEvent(new Event("ended"));
    });
    await expect(panel.getByTestId("replay-trim-overlay")).toBeVisible({ timeout: 15_000 });
  });

  test("바는 앱 테마의 반대 표면이다 — 라이트에선 패널보다 어둡고 다크에선 밝다", async () => {
    const original = await currentTheme();
    try {
      await setTheme("light");
      await startRecording();
      await panel.getByTestId("subtab-console").click();
      await expect(bar()).toBeVisible();
      expect(await lum('[data-testid="recording-bar"]')).toBeLessThan(await lum("body"));

      // 녹화를 이어간 채 테마만 바꾼다 — DebugTab은 메인 탭 전환에도 마운트가 유지돼 서브탭이 그대로다.
      await setTheme("dark");
      await enterDebug(panel);
      await expect(bar()).toBeVisible();
      expect(await lum('[data-testid="recording-bar"]')).toBeGreaterThan(await lum("body"));
    } finally {
      await setTheme(original);
      await enterDebug(panel);
    }
  });

  test("패널 폭 320px에서 5개 로케일 모두 바가 넘치지 않고 [완료]가 패널 안에 있다", async () => {
    const originalViewport = panel.viewportSize();
    await openSettings(panel, "general");
    const originalLocale = (await panel.getByTestId("settings-locale").innerText()).trim();
    try {
      await panel.setViewportSize({ width: 320, height: 800 });
      await startRecording();
      await panel.getByTestId("subtab-console").click();
      for (const label of Object.values(LOCALE_LABELS)) {
        await setScreenLocale(panel, label);
        await enterDebug(panel);
        await expect(bar()).toBeVisible();
        const fit = await bar().evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        expect(fit.scroll, label).toBeLessThanOrEqual(fit.client);
        const stop = await panel.getByTestId("recording-bar-stop").boundingBox();
        expect(stop!.x + stop!.width, label).toBeLessThanOrEqual(320);
      }
    } finally {
      await setScreenLocale(panel, originalLocale);
      await enterDebug(panel);
      if (originalViewport) await panel.setViewportSize(originalViewport);
    }
  });
});
