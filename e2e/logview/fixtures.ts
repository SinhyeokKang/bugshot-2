import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { LogViewerData, LogViewerReport } from "../../src/types/log-viewer";
import type { ActionLog } from "../../src/types/action";
import type { ConsoleLog } from "../../src/types/console";
import type { NetworkLog, NetworkRequest } from "../../src/types/network";

// log-viewer는 viteSingleFile 빌드라 dist-log-viewer/index.html 한 장에 css/js가 모두 inline돼
// 있다. 확장 컨텍스트 없이 이 HTML의 #__BUGSHOT_DATA__ placeholder에 합성 데이터를 평문 JSON으로
// 박아 setContent로 연다(main.tsx는 type이 gzip-base64가 아니면 평문 JSON 경로로 파싱).
const VIEWER_HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../dist-log-viewer/index.html"),
  "utf8",
);

// 두 origin으로 갈라 OriginFilterBar(>=2 origin) 노출을 만든다.
export const ORIGIN_A = "http://alpha.e2e/";
export const ORIGIN_B = "http://beta.e2e/";

/** 합성 LogViewerData를 dist HTML에 주입해 연다. video/screenshot 미지정 시 단일 패널 모드. */
export async function openViewer(page: Page, data: Partial<LogViewerData>): Promise<void> {
  const full: LogViewerData = {
    networkLog: null,
    consoleLog: null,
    actionLog: null,
    video: null,
    screenshot: null,
    report: null,
    meta: {
      version: "0.0.0-e2e",
      createdAt: "2026-01-01T00:00:00.000Z",
      pageUrl: ORIGIN_A,
    },
    ...data,
  };
  // `<`를 escape해 본문 값이 </script>로 태그를 깨지 않게 한다(buildLogsHtml과 동일 가드).
  const json = JSON.stringify(full).replace(/</g, "\\u003c");
  const html = VIEWER_HTML.replace(
    /<script id="__BUGSHOT_DATA__"[^>]*><\/script>/,
    () => `<script id="__BUGSHOT_DATA__">${json}</script>`,
  );
  await page.setContent(html, { waitUntil: "load" });
}

// ── 합성 데이터 빌더 ─────────────────────────────────────────────

export const T0 = 1_700_000_000_000;

// 마커·seek 검증엔 실제 재생 가능한 영상이 필요하다(마커 렌더 게이트 = <video>의 finite duration).
// 이 헤드리스 chromium은 MediaRecorder 산출물의 duration을 finite로 보고하므로(mp4/webm 공통),
// canvas를 잠깐 녹화해 data URL을 즉석 생성한다 — 커밋 미디어 fixture 불요. startedAt=T0로 열면
// T0+ms 타임스탬프 로그가 (ms/1000)초로 매핑된다. openViewer 전(setContent 전) 페이지에서 호출.
export async function generateTinyVideoDataUrl(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
    const stream = c.captureStream(15);
    const mr = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((res) => { mr.onstop = () => res(); });
    mr.start();
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) {
      ctx.fillStyle = `hsl(${(performance.now() / 4) % 360},70%,50%)`;
      ctx.fillRect(0, 0, 64, 64);
      await new Promise((r) => setTimeout(r, 50));
    }
    mr.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mime });
    return await new Promise<string>((res) => {
      const f = new FileReader();
      f.onload = () => res(f.result as string);
      f.readAsDataURL(blob);
    });
  });
}

/** click/navigation/input/keypress/toggle/select 6종 + 2 origin. 필터 6+all, raw-key 회귀용. */
export function makeActionLog(): ActionLog {
  const entries: ActionLog["entries"] = [
    { id: "a-click", kind: "click", timestamp: T0 + 100, pageUrl: ORIGIN_A, target: "Save button", role: "button" },
    { id: "a-nav", kind: "navigation", timestamp: T0 + 200, pageUrl: ORIGIN_A, navType: "pushState", toUrl: "http://alpha.e2e/next" },
    { id: "a-input", kind: "input", timestamp: T0 + 300, pageUrl: ORIGIN_A, fieldLabel: "Email", value: "neo@e2e.test" },
    { id: "a-keys", kind: "keypress", timestamp: T0 + 400, pageUrl: ORIGIN_A, value: "Ctrl+K" },
    { id: "a-toggle", kind: "toggle", timestamp: T0 + 500, pageUrl: ORIGIN_B, fieldLabel: "Subscribe", value: "checked" },
    { id: "a-select", kind: "select", timestamp: T0 + 600, pageUrl: ORIGIN_B, fieldLabel: "Country", value: "Korea" },
  ];
  return { id: "act", startedAt: T0, endedAt: T0 + 600, totalSeen: entries.length, captured: entries.length, entries };
}

/** error/warn/info/log/debug 5종 + 2 origin. 본문 검색용 마커 포함. */
export function makeConsoleLog(): ConsoleLog {
  const entries: ConsoleLog["entries"] = [
    { id: "c-err", level: "error", timestamp: T0 + 100, pageUrl: ORIGIN_A, args: "TypeError: boom zqxconsoleneedle" },
    { id: "c-warn", level: "warn", timestamp: T0 + 200, pageUrl: ORIGIN_A, args: "deprecated api" },
    { id: "c-info", level: "info", timestamp: T0 + 300, pageUrl: ORIGIN_A, args: "info line" },
    { id: "c-log", level: "log", timestamp: T0 + 400, pageUrl: ORIGIN_B, args: "plain log" },
    { id: "c-debug", level: "debug", timestamp: T0 + 500, pageUrl: ORIGIN_B, args: "debug trace" },
  ];
  return { id: "con", startedAt: T0, endedAt: T0 + 500, totalSeen: entries.length, captured: entries.length, entries };
}

function req(partial: Partial<NetworkRequest> & Pick<NetworkRequest, "id" | "url" | "contentType">): NetworkRequest {
  return {
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: T0 + 100,
    durationMs: 12,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: ORIGIN_A,
    requestBodySize: 0,
    responseBodySize: 0,
    phase: "complete",
    ...partial,
  };
}

// 본문에만 있는(URL엔 없는) 마커 — 네트워크 본문 검색 판정용.
export const NET_BODY_NEEDLE = "zqxbodyneedle";

/** json/js/css/img/doc/other 다양 contentType + 본문 마커 요청 + 2 origin. */
export function makeNetworkLog(): NetworkLog {
  const requests: NetworkRequest[] = [
    req({ id: "n-json", url: "http://alpha.e2e/api/data", contentType: "application/json", method: "POST",
      responseBody: JSON.stringify({ note: NET_BODY_NEEDLE }) }),
    req({ id: "n-js", url: "http://alpha.e2e/app.js", contentType: "application/javascript" }),
    req({ id: "n-css", url: "http://alpha.e2e/main.css", contentType: "text/css" }),
    req({ id: "n-img", url: "http://alpha.e2e/logo.png", contentType: "image/png" }),
    req({ id: "n-doc", url: "http://beta.e2e/page", contentType: "text/html", pageUrl: ORIGIN_B }),
    req({ id: "n-other", url: "http://beta.e2e/blob", contentType: "application/octet-stream", pageUrl: ORIGIN_B }),
    req({ id: "n-404", url: "http://alpha.e2e/missing", contentType: "text/plain", status: 404, statusText: "Not Found" }),
  ];
  return { id: "net", startedAt: T0, endedAt: T0 + 200, totalSeen: requests.length, captured: requests.length, warnings: [], requests };
}

// 미리 빌드된 클립보드 페이로드 마커 — copy 동작 판정용.
export const REPORT_COPY_MARKDOWN = "# Login button misaligned\n\nThe login button overflows zqxreportneedle.";

/** Report 탭(IssuePreviewView) — env 2행 + paragraph/orderedList 섹션 + copy 페이로드. */
export function makeReport(): LogViewerReport {
  return {
    title: "Login button misaligned",
    envTitle: "Environment",
    env: [
      { label: "URL", value: "http://alpha.e2e/login" },
      { label: "Browser", value: "Chrome 130" },
    ],
    sections: [
      { id: "description", label: "Description", renderAs: "paragraph", value: "The **login** button overflows." },
      { id: "steps", label: "Steps", renderAs: "orderedList", value: "Open the page\nClick login" },
    ],
    copy: { markdown: REPORT_COPY_MARKDOWN, html: "<h1>Login button misaligned</h1>" },
  };
}

// navigator.clipboard stub — write(rich)를 reject시켜 copyReport가 writeText(markdown) 폴백을
// 타게 하고, 그 텍스트를 window.__copiedText로 노출(권한·실 클립보드 의존 제거 + payload 검증).
// setContent 페이지엔 addInitScript가 안 먹어 openViewer 후 evaluate로 주입한다(copyReport는
// 클릭 시점에 navigator.clipboard를 읽으므로 마운트 후 덮어도 반영됨).
export async function stubClipboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __copiedText: string | null }).__copiedText = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => {
          throw new Error("no rich clipboard in test");
        },
        writeText: async (text: string) => {
          (window as unknown as { __copiedText: string | null }).__copiedText = text;
        },
      },
    });
  });
}

export { test, expect };
