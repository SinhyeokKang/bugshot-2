import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/extension";
import type { ExtContext } from "./fixtures/extension";

// 녹화 중 그리기 오버레이 — annotation.show/setTool/hide 메시지를 SW에서 content script(picker
// 엔트리, all_frames 자동 주입)로 직접 보내 페이지 DOM(open shadow host)을 판정한다. 실 녹화
// (tabCapture/getDisplayMedia)는 headed 자동화에서 불안정이라 배제하고 메시지 경로만 검증한다.
// 획은 open shadow의 svg <g>로 세고, 페이드(3초)는 판정 밖(수동).
// setTool: pen/highlight는 color·strokeWidth·opacity를 싣고, off는 { tool: null }.

const HOST_ID = "__bugshot_annotation_host";

test.describe.serial("recording annotation overlay", () => {
  let fixture: Page;
  let extCtx: ExtContext;
  let tabId: number;

  async function send(msg: Record<string, unknown>): Promise<void> {
    await extCtx.evalInExt(
      ([t, m]) => chrome.tabs.sendMessage(t as number, m as object),
      [tabId, msg] as [number, Record<string, unknown>],
    );
  }

  // open shadow 안의 획(<g>) 개수. host 없으면 -1.
  function strokeCount(): Promise<number> {
    return fixture.evaluate((id) => {
      const host = document.getElementById(id);
      const sr = host?.shadowRoot;
      return sr ? sr.querySelectorAll("svg g").length : -1;
    }, HOST_ID);
  }

  async function drag(): Promise<void> {
    await fixture.bringToFront();
    await fixture.mouse.move(120, 120);
    await fixture.mouse.down();
    await fixture.mouse.move(240, 220, { steps: 8 });
    await fixture.mouse.up();
  }

  // 마지막 획 path의 d 속성 — 박스는 자유곡선과 달리 닫힌 사각형(정점 5개, 마지막이 시작점)이다.
  async function lastPathD(): Promise<string> {
    return fixture.evaluate((id) => {
      const host = document.getElementById(id);
      const paths = host?.shadowRoot?.querySelectorAll("svg g path");
      const last = paths?.[paths.length - 1];
      return last?.getAttribute("d") ?? "";
    }, HOST_ID);
  }

  // 마지막 획 <g>의 유일한 <path> 스타일. 흰 아웃라인 제거로 그룹당 path 1개(pathCount로 검증).
  function lastPathStyle(): Promise<{
    pathCount: number;
    stroke: string | null;
    strokeWidth: string | null;
    strokeOpacity: string | null;
  } | null> {
    return fixture.evaluate((id) => {
      const sr = document.getElementById(id)?.shadowRoot;
      const groups = sr ? Array.from(sr.querySelectorAll("svg g")) : [];
      const g = groups[groups.length - 1];
      if (!g) return null;
      const paths = g.querySelectorAll("path");
      const p = paths[paths.length - 1];
      return {
        pathCount: paths.length,
        stroke: p?.getAttribute("stroke") ?? null,
        strokeWidth: p?.getAttribute("stroke-width") ?? null,
        strokeOpacity: p?.getAttribute("stroke-opacity") ?? null,
      };
    }, HOST_ID);
  }

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    tabId = await ext.fixtureTabId();
    extCtx = ext;
  });

  test.afterAll(async () => {
    await send({ type: "annotation.hide" }).catch(() => {});
    await fixture.close();
  });

  test("annotation.show → open shadow host가 마운트된다(기본 pass-through)", async () => {
    await send({ type: "annotation.show" });

    const info = await fixture.evaluate((id) => {
      const host = document.getElementById(id) as HTMLElement | null;
      if (!host) return null;
      const sr = host.shadowRoot; // open mode라 페이지에서 접근 가능
      const blocker = sr?.querySelector(".blocker") as HTMLElement | null;
      return {
        open: !!sr,
        svg: !!sr?.querySelector("svg"),
        blocker: !!blocker,
        hostPointerEvents: getComputedStyle(host).pointerEvents,
        blockerHasPen: blocker?.classList.contains("pen") ?? true,
      };
    }, HOST_ID);

    expect(info).toEqual({
      open: true,
      svg: true,
      blocker: true,
      hostPointerEvents: "none", // 기본 pass-through
      blockerHasPen: false, // 펜 OFF로 마운트
    });
  });

  test("펜 ON + 드래그 → 획 <g>가 추가된다", async () => {
    await send({ type: "annotation.setTool", tool: "pen", color: "#ef4444", strokeWidth: 4, opacity: 1 });
    const before = await strokeCount();

    await drag();

    // 드래그 커밋은 pointerup 직후 동기지만 입력 이벤트 전파를 폴링으로 흡수.
    await expect.poll(() => strokeCount()).toBeGreaterThan(before);
  });

  test("형광펜 setTool + 드래그 → 획 path에 색·두께배율·반투명 스타일이 박힌다", async () => {
    // 이전 획과 격리(3초 페이드 race 회피)하려 오버레이를 새로 마운트해 획 0에서 시작.
    await send({ type: "annotation.hide" });
    await send({ type: "annotation.show" });
    await send({ type: "annotation.setTool", tool: "highlight", color: "#3b82f6", strokeWidth: 16, opacity: 0.4 });

    await drag();

    await expect.poll(() => strokeCount()).toBeGreaterThan(0);
    // sidepanel이 실어 보낸 스타일이 획 path에 그대로(highlight=두께배율·반투명), path는 그룹당 1개(흰 아웃라인 없음).
    expect(await lastPathStyle()).toEqual({
      pathCount: 1,
      stroke: "#3b82f6",
      strokeWidth: "16",
      strokeOpacity: "0.4",
    });
  });

  test("박스 setTool + 드래그 → 자유곡선이 아니라 닫힌 사각형이 그려진다", async () => {
    await send({ type: "annotation.hide" });
    await send({ type: "annotation.show" });
    await send({ type: "annotation.setTool", tool: "rect", color: "#22c55e", strokeWidth: 4, opacity: 1 });

    await drag();

    await expect.poll(() => strokeCount()).toBeGreaterThan(0);
    // 사각형은 앵커→현재점으로 매번 재생성되므로 드래그 스텝 수와 무관하게 정점이 5개(닫힘)다.
    const d = await lastPathD();
    const verts = d.split(/[ML]/).filter((seg) => seg.trim().length > 0);
    expect(verts).toHaveLength(5);
    expect(verts[0].trim()).toBe(verts[4].trim());
    // 스타일은 pen과 동일(불투명·프리셋 두께).
    expect(await lastPathStyle()).toEqual({
      pathCount: 1,
      stroke: "#22c55e",
      strokeWidth: "4",
      strokeOpacity: "1",
    });
  });

  test("펜 OFF → 드래그해도 획이 안 생기고 페이지 클릭이 통과한다", async () => {
    // 이전 테스트의 획(3초 수명)과 무관하게 판정하도록 오버레이를 새로 마운트(획 0).
    await send({ type: "annotation.hide" });
    await send({ type: "annotation.show" });
    await send({ type: "annotation.setTool", tool: null });
    expect(await strokeCount()).toBe(0);

    await fixture.evaluate(() => {
      (window as unknown as { __hit: boolean }).__hit = false;
      document.addEventListener(
        "click",
        () => {
          (window as unknown as { __hit: boolean }).__hit = true;
        },
        { once: true },
      );
    });

    await drag();

    // 획이 안 생김.
    expect(await strokeCount()).toBe(0);
    // 페이지가 클릭을 받음(blocker pass-through).
    await fixture.mouse.click(140, 140);
    expect(
      await fixture.evaluate(() => (window as unknown as { __hit: boolean }).__hit),
    ).toBe(true);
  });

  test("annotation.hide → 오버레이 host가 제거된다", async () => {
    await send({ type: "annotation.hide" });

    await expect
      .poll(() =>
        fixture.evaluate((id) => document.getElementById(id) === null, HOST_ID),
      )
      .toBe(true);
  });
});
