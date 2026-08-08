import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 디바이스 뷰포트가 picker-control에 얹은 두 계약을 잠근다.
// ① 확장 reload로 top picker가 고아가 되면 device.state 조회 전에 스스로 재주입한다.
// ② 문서 열거가 실패하면 sentinel을 발행하지 않고 **실패로 올린다** — 조용히 성공으로 접으면
//    useBackgroundRecorder가 재시도 트리거를 잃어 그 탭의 로그가 통째로 빈다.

// 키만 남긴다 — 실제 ko/en 문구는 locales.test.ts가 맡는다.
vi.mock("@/i18n", () => ({ t: (key: string) => key }));

const MANIFEST = { content_scripts: [{ js: ["picker.js"], all_frames: true }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("deviceState 확장 reload 자가복구", () => {
  it("top ping 실패 시 picker를 재주입한 뒤 상태를 조회한다", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("orphan content script"))
      .mockResolvedValueOnce({ type: "pong" })
      .mockResolvedValueOnce({ width: 390, available: { width: 1512, height: 800 } });
    const executeScript = vi.fn(async () => []);
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => MANIFEST },
      tabs: { sendMessage },
      scripting: { executeScript },
    });

    const { deviceState } = await import("../picker-control");
    await expect(deviceState(1)).resolves.toEqual({
      width: 390,
      available: { width: 1512, height: 800 },
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: true },
      files: ["picker.js"],
    });
    expect(sendMessage.mock.calls.at(-1)?.[1]).toEqual({ type: "device.state" });
  });

  it("미지원 페이지라 재주입까지 실패하면 undefined로 접는다", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => MANIFEST },
      tabs: { sendMessage: vi.fn().mockRejectedValue(new Error("no receiver")) },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error("blocked")) },
    });

    const { deviceState } = await import("../picker-control");
    await expect(deviceState(1)).resolves.toBeUndefined();
  });
});

// frameCommitted는 background가 큐 밖에서 onCommitted 즉시 푸시하는데 picker는 document_idle
// 주입이다 — 재수립이 그 창에서 device.set을 쏘면 리시버가 없어 undefined가 돌아오고,
// 컨트롤러는 그걸 "차단"으로 접어 정상 페이지를 롤백하며 오탐 토스트를 띄운다.
describe("deviceSet 주입 보장", () => {
  it("top ping 실패 시 picker를 재주입한 뒤 device.set을 보낸다", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("orphan content script"))
      .mockResolvedValueOnce({ type: "pong" })
      .mockResolvedValueOnce({ ok: true, width: 390, available: { width: 1512, height: 800 } });
    const executeScript = vi.fn(async () => []);
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => MANIFEST },
      tabs: { sendMessage },
      scripting: { executeScript },
    });

    const { deviceSet } = await import("../picker-control");
    await expect(deviceSet(1, 390)).resolves.toEqual({
      ok: true,
      width: 390,
      available: { width: 1512, height: 800 },
    });
    expect(executeScript).toHaveBeenCalled();
    // title은 래퍼 iframe의 접근명 — content script가 사전을 못 읽어 여기서 실어 보낸다.
    expect(sendMessage.mock.calls.at(-1)?.[1]).toEqual({
      type: "device.set",
      width: 390,
      title: "issue.device.frameTitle",
    });
  });

  // 재주입까지 실패하면 진짜로 못 보내는 페이지다 — 그때만 undefined로 접어 롤백에 맡긴다.
  it("재주입까지 실패하면 undefined로 접는다", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => MANIFEST },
      tabs: { sendMessage: vi.fn().mockRejectedValue(new Error("no receiver")) },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error("blocked")) },
    });

    const { deviceSet } = await import("../picker-control");
    await expect(deviceSet(1, 390)).resolves.toBeUndefined();
  });
});

// 래퍼 안에서 same-origin 이동을 해도 top URL은 안 바뀐다 — 캡처가 `chrome.tabs.get().url`을
// 그대로 기록하면 리포트 Page 행·logs.html pageUrl·세션 pageKey가 전부 사용자가 본 화면이
// 아니라 모드 진입 시점의 주소를 가리킨다.
// stop ACK가 소진되면 그 문서의 레코더는 무장된 채 남는다 — 게이트는 *재*발행만 막지 이미
// 무장된 레코더를 못 끈다. 래퍼 서브트리 **밖** 문서(숨겨진 top과 그 iframe들)는 이동하지도
// 않으므로 "새 문서는 frameCommitted가 다시 판정한다"는 자가치유 논거가 성립하지 않는다.
// 결과는 그 세션 내내 로그 2벌인데, 반환값이 버려져 경고가 0건이었다.
describe("activateRecordersInDeviceTree — stop ACK 소진", () => {
  function stub(failFor: (documentId: string) => boolean) {
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => MANIFEST,
        lastError: undefined,
        sendMessage: vi.fn((_req: unknown, cb: (res: unknown) => void) => {
          cb({ ok: true, result: { all: ["top", "wrap"], deviceTree: ["wrap"] } });
        }),
      },
      tabs: {
        sendMessage: vi.fn(async (_tabId: number, _msg: unknown, opts?: { documentId?: string }) => {
          if (opts?.documentId && failFor(opts.documentId)) throw new Error("no receiver");
          return {};
        }),
      },
      scripting: { executeScript: vi.fn(async () => []) },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      },
    });
  }

  it("래퍼 밖 문서의 stop이 소진되면 notReached다", async () => {
    stub((id) => id === "top");
    const { activateRecordersInDeviceTree } = await import("../picker-control");
    await expect(activateRecordersInDeviceTree(1, () => {})).resolves.toBe("notReached");
  });

  // 래퍼 서브트리 안 문서는 곧 갈릴 수 있고 frameCommitted가 다시 판정한다 — 기존 관용을 유지한다.
  it("래퍼 안 문서의 stop 실패는 전이를 깨지 않는다", async () => {
    stub((id) => id === "wrap");
    const { activateRecordersInDeviceTree } = await import("../picker-control");
    await expect(activateRecordersInDeviceTree(1, () => {})).resolves.toBe("ok");
  });
});

describe("resolvePageUrl", () => {
  function stubDeviceState(response: unknown) {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => MANIFEST },
      tabs: { sendMessage: vi.fn(async () => response) },
      scripting: { executeScript: vi.fn(async () => []) },
    });
  }

  it("페이지가 알려준 주소를 fallback보다 우선한다", async () => {
    stubDeviceState({
      width: 390,
      available: { width: 390, height: 800 },
      pageUrl: "https://a.com/detail",
    });

    const { resolvePageUrl } = await import("../picker-control");
    await expect(resolvePageUrl(1, "https://a.com/list")).resolves.toBe("https://a.com/detail");
  });

  it("조회가 실패하면 fallback을 쓴다", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => MANIFEST },
      tabs: { sendMessage: vi.fn().mockRejectedValue(new Error("no receiver")) },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error("blocked")) },
    });

    const { resolvePageUrl } = await import("../picker-control");
    await expect(resolvePageUrl(1, "https://a.com/list")).resolves.toBe("https://a.com/list");
  });

  // 구버전 content script가 살아있는 탭(확장 업데이트 직후)은 pageUrl 없이 응답한다.
  it("응답에 pageUrl이 비어 있으면 fallback을 쓴다", async () => {
    stubDeviceState({ width: null, available: { width: 1512, height: 800 }, pageUrl: "" });

    const { resolvePageUrl } = await import("../picker-control");
    await expect(resolvePageUrl(1, "https://a.com/list")).resolves.toBe("https://a.com/list");
  });

  // 헬퍼가 맞아도 호출부가 안 쓰면 무의미한데, 진입점들은 전부 chrome.tabs·store·content
  // 왕복이 얽힌 브라우저 바운드라 유닛으로 못 돈다 — nav-order-contract와 같은 원문 대조로 잠근다.
  //
  // **한 파일만 훑으면 안 된다.** `target.url` 생산자는 picker-control 밖에도 있고, 일부만
  // 전환하면 같은 진입 화면의 버튼끼리 기록 주소가 갈린다(영역 캡처는 래퍼 주소, 탭 녹화는
  // top 주소). 소비자(세션 만료·styling 재바인딩)는 슬롯 하나만 보므로 그 불일치가 곧
  // 오탐 만료가 된다. 생산자 파일 전부를 분모에 둔다.
  it("target.url 생산자가 전부 resolvePageUrl을 거친다", () => {
    const PRODUCERS = [
      "picker-control.ts",
      "video-capture.ts",
      "video-recorder.ts",
      "30s-replay/use-30s-replay.ts",
    ];
    for (const rel of PRODUCERS) {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf8");
      // `url: tab.url ?? <폴백>`이 생산자 관용구다. `classifyTabSupport({ url: tab.url })`
      // 같은 지원 판정은 top 주소가 맞으므로 분모에 넣지 않는다(`??`가 없어 자연히 갈린다).
      expect(src, `${rel}이 tab.url을 그대로 넣는다`).not.toMatch(/url: tab\??\.url \?\?/);
    }
  });
});

function stubChrome(documentsResponse: (req: unknown) => unknown) {
  const tabsSendMessage = vi.fn(async () => ({}));
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest: () => MANIFEST,
      lastError: undefined,
      sendMessage: vi.fn((req: unknown, cb: (res: unknown) => void) => {
        cb(documentsResponse(req));
      }),
    },
    tabs: { sendMessage: tabsSendMessage },
    scripting: { executeScript: vi.fn(async () => []) },
    // 설정 스토어가 import 시점에 hydrate를 시도한다 — 없으면 무해하지만 stderr가 시끄럽다.
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
  vi.stubGlobal("crypto", { randomUUID: () => "sentinel-1" });
  return tabsSendMessage;
}

// 열거 실패 경로는 requestDeviceDocuments의 재시도 sleep(100ms)을 탄다 — 마이크로태스크만
// 흘리면 재발행 IIFE가 아직 첫 await에도 못 가 단언이 공허해진다.
const flushEnumeration = () => new Promise((r) => setTimeout(r, 250));

// ensureContentScript의 ping도 같은 spy에 섞이므로 setSentinel만 골라 본다.
function setSentinelCalls(spy: ReturnType<typeof vi.fn>): unknown[] {
  return spy.mock.calls.filter(
    (call) =>
      typeof (call[1] as { type?: string })?.type === "string" &&
      (call[1] as { type: string }).type.endsWith(".setSentinel"),
  );
}

describe("레코더 활성화 — 문서 열거 fail-closed", () => {
  it("모드 OFF(빈 트리)면 broadcast로 발행하고 값을 돌려준다", async () => {
    const tabsSendMessage = stubChrome(() => ({
      ok: true,
      result: { all: ["top"], deviceTree: [] },
    }));

    const { activateNetworkRecorder } = await import("../picker-control");
    await expect(activateNetworkRecorder(1)).resolves.toBe("sentinel-1");
    expect(tabsSendMessage).toHaveBeenCalledWith(1, {
      type: "networkRecorder.setSentinel",
      sentinel: "sentinel-1",
    });
  });

  // 모드 ON의 핵심 계약 — 숨겨진 top에 안 보내고 래퍼 서브트리 문서만 documentId로 찍는다.
  // 여기가 broadcast로 새면 진짜 top의 레코더가 되살아나 로그가 조용히 2벌이 된다.
  it("모드 ON이면 래퍼 서브트리 문서에만 documentId로 발행한다", async () => {
    const tabsSendMessage = stubChrome(() => ({
      ok: true,
      result: { all: ["top", "wrap", "wrapChild"], deviceTree: ["wrap", "wrapChild"] },
    }));

    const { activateNetworkRecorder } = await import("../picker-control");
    await expect(activateNetworkRecorder(1)).resolves.toBe("sentinel-1");
    const msg = { type: "networkRecorder.setSentinel", sentinel: "sentinel-1" };
    expect(setSentinelCalls(tabsSendMessage)).toEqual([
      [1, msg, { documentId: "wrap" }],
      [1, msg, { documentId: "wrapChild" }],
    ]);
  });

  it("열거가 실패하면 발행하지 않고 실패로 올린다", async () => {
    const tabsSendMessage = stubChrome(() => ({ ok: false, error: "sw cold start" }));

    const { activateNetworkRecorder } = await import("../picker-control");
    await expect(activateNetworkRecorder(1)).rejects.toThrow();
    expect(setSentinelCalls(tabsSendMessage)).toEqual([]);
  });

  // 실패한 활성화의 sentinel이 맵에 남으면, 이후 커밋된 iframe에만 재발행돼 top 없는
  // 반쪽 로그가 된다. **재발행 라운드는 열거를 성공시켜야** 이 단언이 forgetSentinel을
  // 실제로 잠근다 — 양쪽 다 실패시키면 게이트가 먼저 튕겨 픽스 없이도 통과한다.
  it("실패한 활성화의 sentinel은 재발행 대상으로 남지 않는다", async () => {
    let enumerationOk = false;
    const tabsSendMessage = stubChrome(() =>
      enumerationOk
        ? { ok: true, result: { all: ["top", "child"], deviceTree: [] } }
        : { ok: false, error: "sw cold start" },
    );

    const mod = await import("../picker-control");
    await expect(mod.activateNetworkRecorder(1)).rejects.toThrow();

    enumerationOk = true;
    tabsSendMessage.mockClear();
    mod.rebroadcastSentinelsToFrame(1, 3, "child");
    await flushEnumeration();
    expect(setSentinelCalls(tabsSendMessage)).toEqual([]);
  });

  // 위 테스트가 공허하지 않다는 증명 — 같은 재발행 라운드에서 sentinel이 남아 있으면 나간다.
  it("성공한 활성화의 sentinel은 이후 커밋된 프레임에 재발행된다", async () => {
    const tabsSendMessage = stubChrome(() => ({
      ok: true,
      result: { all: ["top", "child"], deviceTree: [] },
    }));

    const mod = await import("../picker-control");
    await mod.activateNetworkRecorder(1);
    tabsSendMessage.mockClear();
    mod.rebroadcastSentinelsToFrame(1, 3, "child");
    await flushEnumeration();
    expect(setSentinelCalls(tabsSendMessage)).toHaveLength(1);
  });
});
