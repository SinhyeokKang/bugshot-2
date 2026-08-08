import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVICE_FRAME_ID } from "@/content/device-frame";

type Viewport = { width: number; height: number };
type InjectedFn = () => Viewport;

// getTopViewport가 chrome.scripting.executeScript에 넘기는 func을 가로챈다.
async function captureInjectedFunc(): Promise<InjectedFn> {
  let captured: InjectedFn | null = null;
  vi.stubGlobal("chrome", {
    scripting: {
      executeScript: vi.fn(async (opts: { func: InjectedFn }) => {
        captured = opts.func;
        return [{ result: { width: 0, height: 0 } }];
      }),
    },
  });
  const { getTopViewport } = await import("../picker-control");
  await getTopViewport(1);
  if (!captured) throw new Error("executeScript에 func이 안 넘어갔다");
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("getTopViewport 주입 함수", () => {
  it("프레임 id를 인라인 리터럴로 들고 있고 device-frame.ts의 상수와 같다", async () => {
    const func = await captureInjectedFunc();
    expect(func.toString()).toContain(DEVICE_FRAME_ID);
  });

  // 상수를 import하면 typecheck·유닛이 전부 green인데 런타임만 ReferenceError로 죽고
  // picker-control의 catch가 그걸 삼켜 조용히 null로 폴백한다 — 이 기능에서 가장
  // 탐지하기 어려운 회귀 축이다. 직렬화 → 재평가로 그 제약을 그대로 재현한다.
  it("self-contained다 — 직렬화·재평가해도 외부 바인딩을 참조하지 않는다", async () => {
    const func = await captureInjectedFunc();
    const reevaluated = new Function(`return (${func.toString()});`)() as InjectedFn;
    vi.stubGlobal("document", { getElementById: () => null });
    vi.stubGlobal("window", { innerWidth: 1512, innerHeight: 800 });
    expect(() => reevaluated()).not.toThrow();
  });

  it("모드 OFF에서 반환값이 이전과 동일하다 (window.innerWidth/innerHeight)", async () => {
    const func = await captureInjectedFunc();
    const reevaluated = new Function(`return (${func.toString()});`)() as InjectedFn;
    vi.stubGlobal("document", { getElementById: () => null });
    vi.stubGlobal("window", { innerWidth: 1512, innerHeight: 800 });
    expect(reevaluated()).toEqual({ width: 1512, height: 800 });
  });

  // 래퍼 요소의 content box는 **안쪽 문서의 스크롤바를 안 뺀다** — 그러면 리포트가
  // `Viewport 390`이라 말하는데 그 문서의 `innerWidth`·미디어쿼리 기준은 375다. 모드 OFF는
  // `window.innerWidth`라 스크롤바가 빠지므로, 안 맞추면 같은 페이지에서 두 모드의 숫자
  // 의미가 갈린다. same-origin 불변식 덕에 안쪽 문서를 그냥 읽을 수 있다.
  it("모드 ON에서 래퍼 **내부 문서**의 innerWidth를 우선한다", async () => {
    const func = await captureInjectedFunc();
    vi.stubGlobal("document", {
      getElementById: (id: string) =>
        id === DEVICE_FRAME_ID
          ? {
              clientWidth: 390,
              clientHeight: 800,
              contentWindow: { innerWidth: 375, innerHeight: 800 },
            }
          : null,
    });
    vi.stubGlobal("window", { innerWidth: 1512, innerHeight: 800 });
    expect(func()).toEqual({ width: 375, height: 800 });
  });

  // 커밋 전이거나 접근이 throw하면(불변식이 깨진 순간) 요소 박스로 접는다 — null보다 낫다.
  it("내부 문서를 못 읽으면 래퍼 요소 박스로 접는다", async () => {
    const func = await captureInjectedFunc();
    vi.stubGlobal("document", {
      getElementById: (id: string) =>
        id === DEVICE_FRAME_ID
          ? {
              clientWidth: 390,
              clientHeight: 800,
              get contentWindow() {
                throw new Error("cross-origin");
              },
            }
          : null,
    });
    vi.stubGlobal("window", { innerWidth: 1512, innerHeight: 800 });
    expect(func()).toEqual({ width: 390, height: 800 });
  });

  it("모드 ON에서 래퍼의 clientWidth/clientHeight를 돌려준다", async () => {
    const func = await captureInjectedFunc();
    const reevaluated = new Function(`return (${func.toString()});`)() as InjectedFn;
    vi.stubGlobal("document", {
      getElementById: (id: string) =>
        id === DEVICE_FRAME_ID ? { clientWidth: 390, clientHeight: 800 } : null,
    });
    vi.stubGlobal("window", { innerWidth: 1512, innerHeight: 800 });
    expect(reevaluated()).toEqual({ width: 390, height: 800 });
  });
});
