import { describe, it, expect, vi, afterEach } from "vitest";
import {
  shouldPreserveSession,
  resolveTabSwitch,
  resolveNavigationAction,
  isBroadCoveredUrl,
  activateTab,
  setupTabBindings,
} from "../tab-bindings";

describe("shouldPreserveSession", () => {
  it("returns false for undefined snap", () => {
    expect(shouldPreserveSession(undefined)).toBe(false);
  });

  it("returns false for empty snap", () => {
    expect(shouldPreserveSession({})).toBe(false);
  });

  it("returns true for video mode regardless of phase", () => {
    expect(shouldPreserveSession({ captureMode: "video", phase: "recording" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video", phase: "drafting" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video", phase: "idle" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video" })).toBe(true);
  });

  const frozenModes = ["screenshot", "element", "freeform"] as const;
  const frozenPhases = ["drafting", "previewing", "done"] as const;
  const nonFrozenPhases = ["idle", "picking", "styling", "capturing", "recording"] as const;

  for (const mode of frozenModes) {
    it(`returns true for ${mode} in frozen phases`, () => {
      for (const phase of frozenPhases) {
        expect(shouldPreserveSession({ captureMode: mode, phase })).toBe(true);
      }
    });

    it(`returns false for ${mode} in non-frozen phases`, () => {
      for (const phase of nonFrozenPhases) {
        expect(shouldPreserveSession({ captureMode: mode, phase })).toBe(false);
      }
    });
  }

  it("returns false for unknown captureMode", () => {
    expect(shouldPreserveSession({ captureMode: "unknown", phase: "drafting" })).toBe(false);
  });
});

describe("resolveTabSwitch", () => {
  it("returns null on first activation in a window and records it", () => {
    const map = new Map<number, number>();
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(map.get(1)).toBe(10);
  });

  it("returns the previous tab on switch within the same window", () => {
    const map = new Map<number, number>([[1, 10]]);
    expect(resolveTabSwitch(map, 1, 20)).toBe(10);
    expect(map.get(1)).toBe(20);
  });

  it("returns null when re-activating the same tab", () => {
    const map = new Map<number, number>([[1, 10]]);
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(map.get(1)).toBe(10);
  });

  it("tracks each window independently (no cross-window stop)", () => {
    const map = new Map<number, number>();
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(resolveTabSwitch(map, 2, 20)).toBeNull();
    // switching back to window 1 stops window 1's prev, not window 2's visible tab
    expect(resolveTabSwitch(map, 1, 11)).toBe(10);
    expect(map.get(2)).toBe(20);
  });
});

describe("resolveNavigationAction", () => {
  type Input = Parameters<typeof resolveNavigationAction>[0];
  type Case = { name: string; input: Input; expected: ReturnType<typeof resolveNavigationAction> };

  // 광역 미보유(broadGranted=false) — <all_urls> required 승격 후 프로덕션에서 도달 불가하나,
  // 순수함수 분기를 잠그는 회귀 자산으로 보존한다(호출부는 항상 broadGranted=true 전달).
  const legacyCases: Case[] = [
    {
      name: "보존 + same-origin → keep (pageKeyChanged 무관)",
      input: { preserved: true, sameOrigin: true, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "keep",
    },
    {
      name: "보존 + cross-origin → notifyDeferredExpiry",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "notifyDeferredExpiry",
    },
    {
      name: "비보존 + same-origin + pageKey 변경 → clearSession",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "clearSession",
    },
    {
      name: "비보존 + same-origin + pageKey 유지 → keep",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: false, broadGranted: false, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "keep",
    },
    {
      name: "비보존 + cross-origin → deactivate",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "deactivate",
    },
    // 미보유 사용자의 가장 흔한 현실 입력 — 새 URL이 커버 범위(http/https)여도 권한이 없으면 현행 분기.
    {
      name: "미보유 + 보존 + cross-origin + 커버 URL → notifyDeferredExpiry",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: true, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "notifyDeferredExpiry",
    },
    {
      name: "미보유 + 비보존 + cross-origin + 커버 URL → deactivate",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: true, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "deactivate",
    },
  ];

  // 광역 보유(broadGranted=true) + 광역 커버 URL(newUrlBroadCovered=true) → cross-origin을 same-origin처럼.
  const broadCoveredCases: Case[] = [
    {
      name: "광역 보유 + 비보존 + cross-origin + 커버 URL → clearSession (패널 유지)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: true, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "clearSession",
    },
    {
      name: "광역 보유 + 보존 + cross-origin + 커버 URL → keep (deferred 예약 없음)",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: true, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "keep",
    },
  ];

  // 광역 보유하지만 비커버 URL(file: 등, newUrlBroadCovered=false) → 현행 분기로 폴백.
  const broadUncoveredCases: Case[] = [
    {
      name: "광역 보유 + 비보존 + cross-origin + 비커버 URL(file:) → deactivate (현행)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "deactivate",
    },
    {
      name: "광역 보유 + 보존 + cross-origin + 비커버 URL(file:) → notifyDeferredExpiry (현행)",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "notifyDeferredExpiry",
    },
  ];

  // 미지원 URL(chrome://·웹스토어)로의 이동 — 판독은 됐고 지원 스킴이 아니다.
  // 여기서만 deactivate 대신 clearSession으로 갈라, 패널이 살아남아 안내를 그린다.
  // "판독 가능"과 "지원"을 별도 축으로 두는 이유: isSupportedUrl(undefined)도 false라
  // 한 축으로 접으면 URL을 못 읽은 경우까지 미지원으로 취급돼 file: 동작이 함께 바뀐다.
  const unsupportedUrlCases: Case[] = [
    {
      name: "비보존 + cross-origin + 판독된 미지원 URL → clearSession (패널 유지, 안내 렌더)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: false, prevUrlSupported: true },
      expected: "clearSession",
    },
    {
      name: "보존 + cross-origin + 판독된 미지원 URL → notifyDeferredExpiry (기존 동작 유지)",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: false, prevUrlSupported: true },
      expected: "notifyDeferredExpiry",
    },
    // 판독 불가 = chrome://와 file:(파일 접근 OFF)를 구분할 수 없는 상태. 둘을 가르지 못하므로
    // file: 동작을 보존하는 쪽(현행 deactivate)으로 남긴다.
    {
      name: "비보존 + cross-origin + 판독 불가 → deactivate (현행 유지 — file:과 구분 불가)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: false, newUrlSupported: false, prevUrlSupported: true },
      expected: "deactivate",
    },
    // 미지원 → 미지원 2번째 이동(chrome://settings → chrome://downloads). activeTab 그랜트는
    // 첫 이동에서 이미 회수돼 새 URL을 못 읽는다. 이전 URL이 이미 미지원이었으면 file:을 보호할
    // 이유가 없으므로(출발지부터 캡처 불가) 패널을 유지한다 — 안 그러면 Phase 2가 hop 1에서만 산다.
    {
      name: "판독 불가 + 이전 URL도 미지원 → clearSession (미지원 안에서의 이동, 패널 유지)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: false, newUrlSupported: false, prevUrlSupported: false },
      expected: "clearSession",
    },
    {
      name: "판독 불가 + 이전 URL은 지원(file: 보호) → deactivate",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: false, newUrlSupported: false, prevUrlSupported: true },
      expected: "deactivate",
    },
    {
      name: "보존 + 판독 불가 + 이전 URL도 미지원 → notifyDeferredExpiry (preserved가 먼저)",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: false, newUrlSupported: false, prevUrlSupported: false },
      expected: "notifyDeferredExpiry",
    },
    {
      name: "same-origin이면 미지원 판정과 무관하게 기존 분기 (pageKey 변경 → clearSession)",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false, newUrlReadable: true, newUrlSupported: false, prevUrlSupported: true },
      expected: "clearSession",
    },
  ];

  // 입력 합성 불변식 — same-origin이면 broadGranted/newUrlBroadCovered가 결과에 영향 없음.
  const invariantCases: Case[] = [
    {
      name: "same-origin이면 broadGranted=true여도 비보존+pageKey 변경 → clearSession",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: true, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "clearSession",
    },
    {
      name: "광역 보유 + 비보존 + cross-origin + 커버 + pageKey 유지(refUrl 동일 path) → keep",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: false, broadGranted: true, newUrlBroadCovered: true, newUrlReadable: true, newUrlSupported: true, prevUrlSupported: true },
      expected: "keep",
    },
  ];

  for (const c of [...legacyCases, ...broadCoveredCases, ...broadUncoveredCases, ...unsupportedUrlCases, ...invariantCases]) {
    it(c.name, () => {
      expect(resolveNavigationAction(c.input)).toBe(c.expected);
    });
  }
});

// host_permissions의 <all_urls>는 광역 권한이 file:까지 포함하지만,
// captureVisibleTab은 file:에 별도 "파일 URL 액세스" 토글을 요구하므로 navigation 분기는
// file:을 의도적으로 비커버(만료 폴백)로 유지해야 한다. 이 경계가 깨지지 않음을 락인한다.
describe("isBroadCoveredUrl", () => {
  it("returns true for https URL", () => {
    expect(isBroadCoveredUrl("https://example.com/path")).toBe(true);
  });

  it("returns true for http URL", () => {
    expect(isBroadCoveredUrl("http://example.com")).toBe(true);
  });

  it("returns false for file: URL (<all_urls> includes it but capture needs a separate toggle)", () => {
    expect(isBroadCoveredUrl("file:///Users/me/page.html")).toBe(false);
  });

  it("returns false for unsupported scheme (chrome:)", () => {
    expect(isBroadCoveredUrl("chrome://settings")).toBe(false);
  });

  it("returns false for blocked host (chromewebstore)", () => {
    expect(isBroadCoveredUrl("https://chromewebstore.google.com/detail/x")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isBroadCoveredUrl(undefined)).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isBroadCoveredUrl("not a url")).toBe(false);
  });
});

// activateTab은 action.onClicked / 단축키 / 컨텍스트 메뉴의 유일한 핸들러이고, e2e는
// ext.openPanel로 이 함수를 우회하며 Playwright는 확장 아이콘을 클릭할 수 없다 —
// 즉 이 describe가 유일한 자동 그물이다. 두 가지를 잠근다:
//   1) 미지원 URL에서도 setOptions·open이 호출된다 (미지원 페이지 패널 오픈)
//   2) 그 호출이 동기다 (await를 끼우면 user gesture가 소실돼 sidePanel.open이 조용히 실패)
describe("activateTab", () => {
  // setOptions/open에 .catch가 붙으므로 스텁은 반드시 thenable을 반환해야 한다.
  // vi.fn()(undefined 반환)이면 TypeError로 죽어 red의 이유가 가드가 아니라 스텁이 된다.
  function stubChrome() {
    const order: string[] = [];
    const setOptions = vi.fn((_opts: chrome.sidePanel.PanelOptions) => {
      order.push("setOptions");
      return Promise.resolve();
    });
    const open = vi.fn((_opts: chrome.sidePanel.OpenOptions) => {
      order.push("open");
      return Promise.resolve();
    });
    const sessionGet = vi.fn(() => Promise.resolve({}));
    const sessionSet = vi.fn(() => Promise.resolve());
    vi.stubGlobal("chrome", {
      sidePanel: { setOptions, open },
      storage: { session: { get: sessionGet, set: sessionSet } },
    });
    return { setOptions, open, sessionGet, sessionSet, order };
  }

  const tab = (over: Partial<chrome.tabs.Tab>) => over as chrome.tabs.Tab;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const unsupportedUrls = [
    "https://chromewebstore.google.com/detail/bugshot/abc",
    "chrome://version",
  ];

  for (const url of unsupportedUrls) {
    it(`미지원 URL(${url})에서도 setOptions와 open을 호출한다`, () => {
      const c = stubChrome();
      activateTab(tab({ id: 7, url }));
      // 의도적으로 await 없음 — 아래 단언이 곧 "동기 호출" 단언이다.
      expect(c.setOptions).toHaveBeenCalledTimes(1);
      expect(c.setOptions.mock.calls[0][0]).toMatchObject({ tabId: 7, enabled: true });
      expect(c.open).toHaveBeenCalledWith({ tabId: 7 });
    });
  }

  it("setOptions가 open보다 먼저 호출된다", () => {
    const c = stubChrome();
    activateTab(tab({ id: 7, url: "chrome://version" }));
    expect(c.order).toEqual(["setOptions", "open"]);
  });

  it("동기 함수를 유지한다 (반환값 undefined — async 승격 방지)", () => {
    stubChrome();
    expect(activateTab(tab({ id: 7, url: "chrome://version" }))).toBeUndefined();
  });

  it("path에 tabId 쿼리를 실어 패널 문서를 탭에 바인딩한다", () => {
    const c = stubChrome();
    activateTab(tab({ id: 42, url: "chrome://version" }));
    expect(c.setOptions.mock.calls[0][0]).toMatchObject({
      path: "src/sidepanel/index.html?tabId=42",
    });
  });

  it("tab.id가 없으면 아무것도 호출하지 않는다", () => {
    const c = stubChrome();
    activateTab(tab({ url: "https://example.com" }));
    expect(c.setOptions).not.toHaveBeenCalled();
    expect(c.open).not.toHaveBeenCalled();
    expect(c.sessionSet).not.toHaveBeenCalled();
  });

  it("지원 URL에서도 동일하게 호출한다 (회귀 방지)", () => {
    const c = stubChrome();
    activateTab(tab({ id: 3, url: "https://example.com/page" }));
    expect(c.setOptions).toHaveBeenCalledTimes(1);
    expect(c.open).toHaveBeenCalledWith({ tabId: 3 });
  });

  it("tab.url이 있으면 activation URL 세션 키를 기록한다", () => {
    const c = stubChrome();
    activateTab(tab({ id: 5, url: "https://example.com/page" }));
    expect(c.sessionSet).toHaveBeenCalledWith({
      "sidePanel:url:5": "https://example.com/page",
    });
  });

  it("tab.url이 없으면(chrome:// 등 판독 불가) 세션 키를 쓰지 않지만 패널은 연다", () => {
    const c = stubChrome();
    activateTab(tab({ id: 9 }));
    expect(c.sessionSet).not.toHaveBeenCalled();
    expect(c.open).toHaveBeenCalledWith({ tabId: 9 });
  });
});

// resolveNavigationAction 표는 촘촘한데, 실제 위험은 그 입력을 만드는
// deactivatePanelIfCrossOrigin의 파생 3줄(`info.url ?? tab.url` → readable → supported)에 있었다.
// 판독 불가 폴백 누락과 빈 문자열 취급 불일치가 둘 다 여기서 나왔으므로 행동 레벨로 잠근다.
describe("deactivatePanelIfCrossOrigin — 입력 파생", () => {
  type UpdatedListener = (
    tabId: number,
    info: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => void;

  const TAB = 7;
  const ACTIVATED_KEY = "sidePanel:activated";
  const URL_KEY = `sidePanel:url:${TAB}`;
  const SESSION_KEY = `editor:${TAB}`;

  /** activated + 세션 없음(비보존) + refUrl 지정 상태로 SW storage를 세운다. */
  function armed(refUrl: string) {
    const store: Record<string, unknown> = {
      [ACTIVATED_KEY]: [TAB],
      [URL_KEY]: refUrl,
    };
    const removed: string[] = [];
    const setOptions = vi.fn((_o: chrome.sidePanel.PanelOptions) => Promise.resolve());
    let onUpdated: UpdatedListener = () => {};

    vi.stubGlobal("chrome", {
      action: { onClicked: { addListener: vi.fn() } },
      sidePanel: { setOptions, open: vi.fn(() => Promise.resolve()) },
      storage: {
        session: {
          get: vi.fn((k: string) => Promise.resolve(k in store ? { [k]: store[k] } : {})),
          set: vi.fn((o: Record<string, unknown>) => {
            Object.assign(store, o);
            return Promise.resolve();
          }),
          remove: vi.fn((k: string) => {
            removed.push(k);
            delete store[k];
            return Promise.resolve();
          }),
        },
      },
      tabs: {
        get: vi.fn(() => Promise.resolve({ id: TAB } as chrome.tabs.Tab)),
        sendMessage: vi.fn(() => Promise.resolve()),
        onActivated: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
        onUpdated: {
          addListener: (l: UpdatedListener) => {
            onUpdated = l;
          },
        },
      },
      windows: { onRemoved: { addListener: vi.fn() } },
      runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
    });

    setupTabBindings();
    return {
      /** 네비게이션 시작(loading)을 흘려보낸다. */
      navigate: (info: chrome.tabs.TabChangeInfo, tabUrl?: string) =>
        onUpdated(TAB, { status: "loading", ...info }, { url: tabUrl } as chrome.tabs.Tab),
      isActivated: () => ((store[ACTIVATED_KEY] as number[] | undefined) ?? []).includes(TAB),
      removed,
      setOptions,
    };
  }

  const settle = () => new Promise((r) => setTimeout(r, 0));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("판독된 미지원 URL → 세션만 지우고 activated 보존 (패널 유지)", async () => {
    const c = armed("https://ex.com/page");
    c.navigate({ url: "chrome://settings" });
    await settle();
    expect(c.removed).toContain(SESSION_KEY);
    expect(c.isActivated()).toBe(true);
  });

  it("info.url이 없으면 tab.url로 폴백해 판정한다", async () => {
    const c = armed("https://ex.com/page");
    c.navigate({}, "chrome://settings");
    await settle();
    expect(c.isActivated()).toBe(true);
  });

  it("빈 문자열은 판독 불가로 접는다 — 지원 출발지면 현행 deactivate", async () => {
    const c = armed("https://ex.com/page");
    c.navigate({ url: "" }, "");
    await settle();
    expect(c.isActivated()).toBe(false);
  });

  it("판독 불가 + 지원 출발지(file: 보호) → deactivate", async () => {
    const c = armed("https://ex.com/page");
    c.navigate({});
    await settle();
    expect(c.isActivated()).toBe(false);
  });

  // hop 2: 첫 이동에서 activeTab 그랜트가 회수돼 새 URL을 못 읽는다.
  it("판독 불가 + 미지원 출발지 → 패널 유지 (미지원 안에서의 2번째 이동)", async () => {
    const c = armed("chrome://settings");
    c.navigate({});
    await settle();
    expect(c.isActivated()).toBe(true);
  });

  it("판독된 지원 URL(file:)은 현행대로 deactivate", async () => {
    const c = armed("https://ex.com/page");
    c.navigate({ url: "file:///Users/me/x.html" });
    await settle();
    expect(c.isActivated()).toBe(false);
  });
});
