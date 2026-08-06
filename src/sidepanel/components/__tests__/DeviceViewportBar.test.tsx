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
  hookState = { width: null, availableWidth: 1512, locked: false, busy: false };
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
    expect(screen.getByRole("status").textContent).toContain("issue.device.status.switching");
    for (const id of ["full", 390, 768, 1024] as const) {
      expect(seg(id).getAttribute("aria-disabled")).toBe("true");
    }
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
      expect(seg(width).textContent).toContain(`issue.device.w${width}`);
    }
  });
});
