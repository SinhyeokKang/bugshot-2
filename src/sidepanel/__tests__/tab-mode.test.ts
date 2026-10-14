import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Shell = typeof import("../tab-mode");

interface FakeTab {
  id: number;
  windowId: number;
  active: boolean;
}

// 창마다 활성 탭이 하나인 최소 브라우저. update(active)는 같은 창의 나머지를 끄고 onActivated를 쏜다.
function fakeBrowser(tabs: FakeTab[], selfId: number | undefined) {
  const byId = new Map(tabs.map((t) => [t.id, { ...t }]));
  const activated: ((info: { tabId: number; windowId: number }) => void)[] = [];
  let updateReturnsActive = true;
  // gateNext로 다음 get/update 한 번을 붙잡아 "조회·전환이 진행 중인 순간"을 만든다.
  const gates: { kind: "get" | "update"; id: number; open: Promise<void>; hit: () => void }[] = [];
  const passGate = async (kind: "get" | "update", id: number) => {
    const i = gates.findIndex((g) => g.kind === kind && g.id === id);
    if (i < 0) return;
    const [g] = gates.splice(i, 1);
    g.hit();
    await g.open;
  };
  const activate = (id: number) => {
    const tab = byId.get(id);
    if (!tab) return;
    for (const t of byId.values()) if (t.windowId === tab.windowId) t.active = t.id === id;
    for (const l of [...activated]) l({ tabId: id, windowId: tab.windowId });
  };
  const api = {
    getCurrent: vi.fn(async () => (selfId == null ? undefined : { ...byId.get(selfId)! })),
    get: vi.fn(async (id: number) => {
      await passGate("get", id);
      const t = byId.get(id);
      if (!t) throw new Error(`No tab with id: ${id}.`);
      return { ...t };
    }),
    update: vi.fn(async (id: number, props: { active?: boolean }) => {
      await passGate("update", id);
      if (props.active && updateReturnsActive) activate(id);
      const t = byId.get(id);
      return t ? { ...t } : undefined;
    }),
    onActivated: {
      addListener: (l: (info: { tabId: number; windowId: number }) => void) => activated.push(l),
      removeListener: (l: (info: { tabId: number; windowId: number }) => void) => {
        const i = activated.indexOf(l);
        if (i >= 0) activated.splice(i, 1);
      },
    },
  };
  return {
    api,
    activate,
    close: (id: number) => byId.delete(id),
    active: (windowId: number) =>
      [...byId.values()].find((t) => t.windowId === windowId && t.active)?.id,
    deferActivation: () => {
      updateReturnsActive = false;
    },
    activatedCount: () => activated.length,
    gateNext: (kind: "get" | "update", id: number) => {
      let open!: () => void;
      let hit!: () => void;
      const hitP = new Promise<void>((r) => (hit = r));
      gates.push({ kind, id, open: new Promise<void>((r) => (open = r)), hit });
      return { open, hit: hitP };
    },
  };
}

const PANEL = 9;
const T = 7;
const X = 8;

let shell: Shell;

async function load(browser: ReturnType<typeof fakeBrowser>) {
  vi.stubGlobal("chrome", { tabs: browser.api });
  vi.resetModules();
  shell = await import("../tab-mode");
}

function updatesTo(browser: ReturnType<typeof fakeBrowser>, id: number) {
  return browser.api.update.mock.calls.filter(([tabId]) => tabId === id).length;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tab-mode 셸 — 사이드패널(getCurrent undefined)", () => {
  it("hold·release가 탭을 건드리지 않는다", async () => {
    const b = fakeBrowser(
      [
        { id: T, windowId: 1, active: false },
        { id: X, windowId: 1, active: true },
      ],
      undefined,
    );
    await load(b);
    expect(await shell.getSelfTab()).toBeNull();
    const release = await shell.holdTarget(T, "capture");
    await release();
    expect(b.api.update).not.toHaveBeenCalled();
  });

  it("chrome.tabs.getCurrent가 throw해도 null로 떨어진다", async () => {
    vi.stubGlobal("chrome", { tabs: { getCurrent: () => Promise.reject(new Error("nope")) } });
    vi.resetModules();
    shell = await import("../tab-mode");
    expect(await shell.getSelfTab()).toBeNull();
  });
});

describe("tab-mode 셸 — 같은 창 탭 모드", () => {
  let b: ReturnType<typeof fakeBrowser>;

  beforeEach(async () => {
    b = fakeBrowser(
      [
        { id: T, windowId: 1, active: false },
        { id: PANEL, windowId: 1, active: true },
        { id: X, windowId: 1, active: false },
      ],
      PANEL,
    );
    await load(b);
  });

  it("비활성 대상 → hold에서 1회 활성화, release에서 1회 패널 복원", async () => {
    const release = await shell.holdTarget(T, "capture");
    expect(b.active(1)).toBe(T);
    await release();
    expect(b.active(1)).toBe(PANEL);
    expect(updatesTo(b, T)).toBe(1);
    expect(updatesTo(b, PANEL)).toBe(1);
  });

  it("getSelfTab은 id만 캐시하고 창은 매번 다시 조회한다", async () => {
    expect(await shell.getSelfTab()).toEqual({ id: PANEL });
    await (await shell.holdTarget(T, "capture"))();
    await (await shell.holdTarget(T, "capture"))();
    expect(b.api.getCurrent).toHaveBeenCalledTimes(1);
    expect(b.api.get.mock.calls.filter(([id]) => id === PANEL).length).toBeGreaterThanOrEqual(2);
  });

  it("병렬 hold 둘 → 활성화 1회, 마지막 release에서만 복원", async () => {
    const [ra, rb] = await Promise.all([
      shell.holdTarget(T, "picking"),
      shell.holdTarget(T, "capture"),
    ]);
    expect(updatesTo(b, T)).toBe(1);
    await ra();
    expect(b.active(1)).toBe(T);
    expect(updatesTo(b, PANEL)).toBe(0);
    await rb();
    expect(b.active(1)).toBe(PANEL);
    expect(updatesTo(b, PANEL)).toBe(1);
  });

  it("중첩 hold(바깥 hold 안에서 안쪽 hold) → 활성화 1회", async () => {
    const outer = await shell.holdTarget(T, "picking");
    await shell.withTargetHold(T, async () => {
      expect(b.active(1)).toBe(T);
    });
    expect(updatesTo(b, PANEL)).toBe(0);
    await outer();
    expect(updatesTo(b, T)).toBe(1);
    expect(updatesTo(b, PANEL)).toBe(1);
  });

  // before 순서: 요소 선택과 같은 태스크에서 잡는 캡처 hold는 picking release보다 먼저 count를 올려야 한다.
  it("hold의 count는 호출 즉시(동기로) 오른다 — 대기 중인 hold가 있으면 다른 release가 복원하지 않는다", async () => {
    const picking = await shell.holdTarget(T, "picking");
    const before = shell.holdTarget(T, "capture"); // await 전
    await picking();
    expect(b.active(1)).toBe(T);
    expect(updatesTo(b, PANEL)).toBe(0);
    await (await before)();
    expect(b.active(1)).toBe(PANEL);
  });

  it("release 시점에 사용자가 제3 탭으로 갔으면 패널을 끌어오지 않는다", async () => {
    const release = await shell.holdTarget(T, "capture");
    b.activate(X);
    await release();
    expect(b.active(1)).toBe(X);
    expect(updatesTo(b, PANEL)).toBe(0);
  });

  it("hold 중 대상이 닫혔으면 복원하지 않는다", async () => {
    const release = await shell.holdTarget(T, "capture");
    b.close(T);
    b.activate(X);
    await release();
    expect(updatesTo(b, PANEL)).toBe(0);
  });

  it("대상이 이미 활성이었으면(우리가 켠 게 아니면) 복원하지 않는다", async () => {
    b.activate(T);
    const release = await shell.holdTarget(T, "capture");
    await release();
    expect(b.api.update).not.toHaveBeenCalled();
    expect(b.active(1)).toBe(T);
  });

  // 영역 드래그는 사용자가 직접 대상으로 가서 그린다 — 활성화는 no-op이지만 끝나면 패널로 돌아온다.
  it("area hold: 대상이 이미 활성(사용자가 이동)이어도 release에서 패널로 복원한다", async () => {
    b.activate(T);
    await shell.withTargetHold(T, async () => {}, "area");
    expect(updatesTo(b, T)).toBe(0);
    expect(b.active(1)).toBe(PANEL);
  });

  it("area hold도 그 사이 제3 탭으로 갔으면 복원하지 않는다", async () => {
    b.activate(T);
    await shell.withTargetHold(T, async () => b.activate(X), "area");
    expect(b.active(1)).toBe(X);
  });

  it("release 직후 새 hold가 오면 끝 상태는 대상 활성 — 늦은 복원이 새 캡처를 가리지 않는다", async () => {
    const first = await shell.holdTarget(T, "capture");
    const releasing = first();
    const second = shell.holdTarget(T, "capture");
    await releasing;
    const releaseSecond = await second;
    expect(b.active(1)).toBe(T);
    await releaseSecond();
    expect(b.active(1)).toBe(PANEL);
  });

  // 복원이 대상 탭을 조회하는 사이 새 hold가 오면 복원을 포기하고 그 hold에 넘긴다(조회 뒤 재확인).
  it("복원 조회 중에 새 hold가 오면 패널로 돌아가지 않는다", async () => {
    const first = await shell.holdTarget(T, "capture");
    const gate = b.gateNext("get", T);
    const releasing = first();
    await gate.hit;
    const second = shell.holdTarget(T, "capture");
    gate.open();
    await releasing;
    const releaseSecond = await second;
    expect(updatesTo(b, PANEL)).toBe(0);
    expect(b.active(1)).toBe(T);
    await releaseSecond();
    expect(b.active(1)).toBe(PANEL);
  });

  // 활성화·복원이 직렬이 아니면, 패널로 돌아가는 중에 온 hold가 "대상은 이미 앞"으로 읽고 넘어가
  // 복원이 끝난 뒤 대상이 가려진 채 캡처가 돈다.
  it("패널 복원 전환이 끝나기 전에 온 hold는 그 전환 뒤에 대상을 다시 앞으로 가져온다", async () => {
    const first = await shell.holdTarget(T, "capture");
    const gate = b.gateNext("update", PANEL);
    const releasing = first();
    await gate.hit;
    const second = shell.holdTarget(T, "capture");
    gate.open();
    await releasing;
    const releaseSecond = await second;
    expect(b.active(1)).toBe(T);
    await releaseSecond();
    expect(b.active(1)).toBe(PANEL);
  });

  // 패널이 뒤에 있는데(사용자가 제3 탭 X에 있는데) 캡처가 트리거되면 대상은 캡처를 위해
  // 앞으로 가져오되, 끝나고 패널로 끌어오지는 않는다 — 사용자는 패널에 있지 않았다.
  it("패널이 앞이 아니었으면 대상을 활성화해도 끝나고 패널로 끌어오지 않는다", async () => {
    b.activate(X);
    const release = await shell.holdTarget(T, "capture");
    expect(b.active(1)).toBe(T);
    await release();
    expect(updatesTo(b, PANEL)).toBe(0);
    expect(b.active(1)).toBe(T);
  });

  it("release는 멱등이다", async () => {
    const a = await shell.holdTarget(T, "capture");
    const c = await shell.holdTarget(T, "capture");
    await a();
    await a();
    expect(b.active(1)).toBe(T);
    await c();
    expect(b.active(1)).toBe(PANEL);
  });

  it("withTargetHold는 run이 throw해도 release한다", async () => {
    await expect(
      shell.withTargetHold(T, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(b.active(1)).toBe(PANEL);
  });

  it("tabs.update 반환값이 아직 비활성이면 onActivated로 확정될 때까지 hold가 안 풀린다", async () => {
    b.deferActivation();
    let resolved = false;
    const held = shell.holdTarget(T, "capture").then((r) => {
      resolved = true;
      return r;
    });
    await vi.waitFor(() => expect(b.activatedCount()).toBe(1));
    expect(resolved).toBe(false);
    b.activate(T);
    const release = await held;
    expect(resolved).toBe(true);
    expect(b.activatedCount()).toBe(0);
    await release();
  });

  it("활성화가 끝내 확정되지 않아도 상한 뒤 진행한다(관문이 거부하면 토스트로 드러난다)", async () => {
    vi.useFakeTimers();
    b.deferActivation();
    const held = shell.holdTarget(T, "capture");
    await vi.advanceTimersByTimeAsync(5000);
    const release = await held;
    expect(b.activatedCount()).toBe(0);
    await release();
  });

  it("focusTab은 지정한 탭을 활성화한다", async () => {
    await shell.focusTab(X);
    expect(b.active(1)).toBe(X);
  });
});

describe("tab-mode 셸 — 대상이 다른 창(별도 창 탭 모드)", () => {
  it("활성화·복원을 하지 않는다", async () => {
    const b = fakeBrowser(
      [
        { id: T, windowId: 1, active: true },
        { id: PANEL, windowId: 2, active: true },
      ],
      PANEL,
    );
    await load(b);
    await (await shell.holdTarget(T, "capture"))();
    expect(b.api.update).not.toHaveBeenCalled();
  });

  it("다른 창의 대상이 그 창에서 비활성이어도 건드리지 않는다(관문이 판정)", async () => {
    const b = fakeBrowser(
      [
        { id: T, windowId: 1, active: false },
        { id: X, windowId: 1, active: true },
        { id: PANEL, windowId: 2, active: true },
      ],
      PANEL,
    );
    await load(b);
    await (await shell.holdTarget(T, "capture"))();
    await shell.withTargetHold(T, async () => {}, "area");
    expect(b.api.update).not.toHaveBeenCalled();
  });
});

// captureVisibleTab 호출은 hold 트랜잭션 안(capture.ts)과, 의도적으로 handoff하지 않는 두 곳뿐이어야 한다.
describe("captureVisibleTab 호출처", () => {
  const ROOT = path.resolve(__dirname, "..");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (name === "__tests__") return [];
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("capture.ts·use-30s-replay.ts·scroll-capture.ts 밖에서 직접 요청하지 않는다", () => {
    const hits = walk(ROOT)
      .filter((f) => /type:\s*"captureVisibleTab"/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(hits).toEqual(["30s-replay/use-30s-replay.ts", "capture.ts", "scroll-capture.ts"]);
  });
});
