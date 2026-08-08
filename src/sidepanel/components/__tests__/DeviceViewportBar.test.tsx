import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { DeviceViewportBar } from "../DeviceViewportBar";

// 키 + 보간만 남긴다 — 실제 ko/en 문구는 locales.test.ts가 맡는다. 여기서 고정하는 건
// "접근명이 폭을 말하는가"이므로 placeholder 치환은 살려둔다.
vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${Object.values(params).join(",")}` : key,
}));

const select = vi.fn();
let hookState: {
  width: number | null;
  availableWidth: number | null;
  locked: boolean;
  busy: boolean;
  busyWidth: number | null;
};
let unsupported = false;

vi.mock("@/sidepanel/hooks/useDeviceViewport", () => ({
  useDeviceViewport: () => ({ ...hookState, select }),
}));
vi.mock("@/sidepanel/hooks/tab-support-context", () => ({
  useUnsupportedTab: () => unsupported,
}));

beforeEach(() => {
  select.mockClear();
  unsupported = false;
  hookState = { width: null, availableWidth: 1512, locked: false, busy: false, busyWidth: null };
});

function seg(width: number | "full"): HTMLElement {
  return screen.getByTestId(`device-preset-${width}`);
}

describe("DeviceViewportBar — 렌더 게이트", () => {
  it("tabId가 null이면 행을 렌더하지 않는다", () => {
    render(<DeviceViewportBar tabId={null} />);
    expect(screen.queryByTestId("device-viewport-bar")).toBeNull();
  });

  it("미지원 탭이면 행을 렌더하지 않는다", () => {
    unsupported = true;
    render(<DeviceViewportBar tabId={1} />);
    expect(screen.queryByTestId("device-viewport-bar")).toBeNull();
  });

  it("행 루트가 자기 컨테이너를 들고 온다 (로그 탭 필터 행과 같은 규칙)", () => {
    render(<DeviceViewportBar tabId={1} />);
    const bar = screen.getByTestId("device-viewport-bar");
    for (const cls of ["shrink-0", "border-b", "border-border", "px-4", "py-4"]) {
      expect(bar.classList.contains(cls)).toBe(true);
    }
  });

  it("세그먼트가 4개다 (전체 + 프리셋 3)", () => {
    render(<DeviceViewportBar tabId={1} />);
    for (const id of ["full", 390, 768, 1024] as const) {
      expect(seg(id)).toBeTruthy();
    }
  });
});

describe("DeviceViewportBar — 가용 폭", () => {
  it("availableWidth=865면 1024만 aria-disabled다", () => {
    hookState.availableWidth = 865;
    render(<DeviceViewportBar tabId={1} />);
    expect(seg(1024).getAttribute("aria-disabled")).toBe("true");
    expect(seg(390).getAttribute("aria-disabled")).not.toBe("true");
    expect(seg(768).getAttribute("aria-disabled")).not.toBe("true");
    expect(seg("full").getAttribute("aria-disabled")).not.toBe("true");
  });

  // watch 구독이 창 리사이즈를 밀어넣는다 — 컴포넌트 재마운트·사용자 조작 없이 풀려야 한다.
  it("865→1200으로 갱신되면 재마운트 없이 1024가 활성화된다", () => {
    hookState.availableWidth = 865;
    const { rerender } = render(<DeviceViewportBar tabId={1} />);
    const before = seg(1024);
    expect(before.getAttribute("aria-disabled")).toBe("true");
    hookState.availableWidth = 1200;
    rerender(<DeviceViewportBar tabId={1} />);
    expect(seg(1024)).toBe(before);
    expect(seg(1024).getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("DeviceViewportBar — 잠금·busy", () => {
  it("locked면 모든 세그먼트가 aria-disabled다", () => {
    hookState.locked = true;
    render(<DeviceViewportBar tabId={1} />);
    for (const id of ["full", 390, 768, 1024] as const) {
      expect(seg(id).getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("busy면 aria-busy·live status가 뜨고 행 전체가 aria-disabled다", () => {
    hookState.busy = true;
    hookState.width = 390;
    render(<DeviceViewportBar tabId={1} />);
    const bar = screen.getByTestId("device-viewport-bar");
    expect(bar.getAttribute("aria-busy")).toBe("true");
    // XFO 사이트는 롤백까지 최대 3초라 무피드백 구간이 생긴다.
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("issue.device.status.switching");
    // aria-busy 서브트리 안이면 그 변경 통지가 완료까지 보류돼 낭독할 창이 안 남는다.
    expect(status.closest("[aria-busy]")).toBeNull();
    for (const id of ["full", 390, 768, 1024] as const) {
      expect(seg(id).getAttribute("aria-disabled")).toBe("true");
    }
  });

  // store의 width는 device.set 응답 전까지 옛 값이다 — `value === key`로 판정하면 390→768에서
  // 스피너가 **떠나는** 390에 뜬다. 진행 표시가 가리키는 대상이 반대가 되면 안 된다.
  it("스피너는 떠나는 세그먼트가 아니라 가려는 세그먼트에 뜬다", () => {
    hookState.busy = true;
    hookState.width = 390;
    hookState.busyWidth = 768;
    render(<DeviceViewportBar tabId={1} />);
    expect(seg(768).querySelector(".animate-spin")).not.toBeNull();
    expect(seg(390).querySelector(".animate-spin")).toBeNull();
  });

  it("전체로 되돌리는 중이면 전체 세그먼트에 뜬다", () => {
    hookState.busy = true;
    hookState.width = 390;
    hookState.busyWidth = null;
    render(<DeviceViewportBar tabId={1} />);
    expect(seg("full").querySelector(".animate-spin")).not.toBeNull();
    expect(seg(390).querySelector(".animate-spin")).toBeNull();
  });

  // shadcn base의 disabled:pointer-events-none이 hover·툴팁을 죽인다(DESIGN.md §14).
  it("잠금에 disabled 속성을 쓰지 않는다 (툴팁이 살아야 한다)", () => {
    hookState.locked = true;
    render(<DeviceViewportBar tabId={1} />);
    for (const id of ["full", 390, 768, 1024] as const) {
      expect(seg(id).hasAttribute("disabled")).toBe(false);
    }
  });
});

describe("DeviceViewportBar — 활성화 가드", () => {
  // Radix Tabs는 aria-disabled를 동작 가드로 해석하지 않는다.
  it("초과 세그먼트는 클릭해도 select가 안 불린다", async () => {
    hookState.availableWidth = 865;
    render(<DeviceViewportBar tabId={1} />);
    await userEvent.click(seg(1024));
    expect(select).not.toHaveBeenCalled();
  });

  it("초과 세그먼트는 Enter·Space로도 활성화되지 않는다", async () => {
    hookState.availableWidth = 865;
    render(<DeviceViewportBar tabId={1} />);
    seg(1024).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(select).not.toHaveBeenCalled();
  });

  // Radix Tabs 기본값은 activationMode="automatic" — 포커스 이동만으로 onValueChange가 돈다.
  // 서브탭·플랫폼 탭에선 무해하지만 여기 onValueChange는 **페이지를 재로드하는 파괴적 동작**이다.
  it("잠기지 않은 상태에서도 화살표키 이동만으로는 select가 안 불린다", async () => {
    render(<DeviceViewportBar tabId={1} />);
    seg("full").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(select).not.toHaveBeenCalled();
    // 명시적 활성화(Enter)에서만 돈다.
    await userEvent.keyboard("{Enter}");
    expect(select).toHaveBeenCalledWith(390);
  });

  it("locked 상태에서는 화살표키 이동으로도 select가 안 불린다", async () => {
    hookState.locked = true;
    render(<DeviceViewportBar tabId={1} />);
    seg("full").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(select).not.toHaveBeenCalled();
  });

  it("정상 상태에서 클릭하면 그 폭으로 select가 불린다", async () => {
    render(<DeviceViewportBar tabId={1} />);
    await userEvent.click(seg(390));
    expect(select).toHaveBeenCalledWith(390);
  });

  it("전체 세그먼트는 null로 select한다", async () => {
    hookState.width = 390;
    render(<DeviceViewportBar tabId={1} />);
    await userEvent.click(seg("full"));
    expect(select).toHaveBeenCalledWith(null);
  });
});

describe("DeviceViewportBar — Tabs 컨텍스트 격리", () => {
  // TabsList만 렌더하면 DebugTab의 바깥 Tabs 컨텍스트를 잡아 세그먼트 클릭이 setSub("390")으로
  // 새어 서브탭이 빈 값으로 전환된다 — 에러 없는 조용한 오동작이다.
  it("바깥 Tabs의 onValueChange로 새지 않는다", async () => {
    const outer = vi.fn();
    render(
      <Tabs value="issue" onValueChange={outer}>
        <DeviceViewportBar tabId={1} />
      </Tabs>,
    );
    await userEvent.click(seg(390));
    expect(outer).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(390);
  });
});

describe("DeviceViewportBar — 접근명", () => {
  it("정상 세그먼트도 hover 툴팁으로 폭 라벨을 보여준다", async () => {
    render(<DeviceViewportBar tabId={1} />);
    await userEvent.hover(seg(390));
    // 라벨은 사전을 거치지 않는다 — DEVICE_PRESETS.width를 그대로 찍는다.
    expect((await screen.findByRole("tooltip")).textContent).toContain("390");
  });

  it("잠긴 세그먼트는 기본 라벨 대신 사유를 보여준다", async () => {
    hookState.availableWidth = 865;
    render(<DeviceViewportBar tabId={1} />);
    await userEvent.hover(seg(1024));
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "issue.device.tooltip.tooNarrow",
    );
  });

  // 라벨이 접혀 아이콘만 남아도 이게 유일한 폭 정보다.
  it("각 세그먼트의 aria-label이 폭을 말한다", () => {
    render(<DeviceViewportBar tabId={1} />);
    expect(seg("full").getAttribute("aria-label")).toBe("issue.device.aria.full");
    for (const width of [390, 768, 1024]) {
      expect(seg(width).getAttribute("aria-label")).toBe(
        `issue.device.aria.width:${width}`,
      );
    }
  });

  it("아이콘이 aria-hidden이라 접근명을 대체하지 않는다", () => {
    render(<DeviceViewportBar tabId={1} />);
    for (const id of ["full", 390, 768, 1024] as const) {
      const svg = seg(id).querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("라벨이 폭 숫자를 병기한다 (아이콘만 두면 기기 에뮬레이션으로 오해된다)", () => {
    render(<DeviceViewportBar tabId={1} />);
    for (const width of [390, 768, 1024]) {
      expect(seg(width).textContent).toContain(String(width));
    }
  });
});
