import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));

let accounts: Record<string, unknown> = {};
vi.mock("@/store/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-store")>();
  return {
    ...actual,
    useSettingsStore: (sel: (s: { accounts: typeof accounts }) => unknown) => sel({ accounts }),
  };
});

vi.mock("@/store/settings-ui-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-ui-store")>();
  return {
    ...actual,
    useSettingsUiStore: (sel: (s: { locale: string; recordingMode: string }) => unknown) =>
      sel({ locale: "ko", recordingMode: "tab" }),
  };
});

import { EmptyState } from "../IssueTab";

const CAPTURE_BUTTONS = [
  "mode-element",
  "mode-element-shot",
  "mode-screenshot",
  "mode-record",
  "replay-button",
] as const;

function handlers() {
  return {
    onStartElement: vi.fn(),
    onStartElementShot: vi.fn(),
    onStartScreenshot: vi.fn(),
    onStartVideo: vi.fn(),
    onStartScreenRecord: vi.fn(),
    onStartFreeform: vi.fn(),
  };
}

beforeEach(() => {
  accounts = {};
  vi.stubGlobal("chrome", {
    tabs: { create: vi.fn() },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      session: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EmptyState — 지원 페이지 (unsupported=false)", () => {
  it("캡처 버튼 5개가 모두 보이고 미지원 안내는 없다", () => {
    render(<EmptyState {...handlers()} unsupported={false} />);
    for (const id of CAPTURE_BUTTONS) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByText("app.captureUnsupported.title")).toBeNull();
  });

  it("[이슈 작성]이 활성이고 클릭하면 핸들러가 호출된다", async () => {
    const h = handlers();
    render(<EmptyState {...h} unsupported={false} />);
    const btn = screen.getByTestId("mode-freeform");
    // 속성이 아예 없는 구현으로 바뀌어도 통과해야 한다 — 잠그는 것은 "비활성이 아님"이다.
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
    await userEvent.click(btn);
    expect(h.onStartFreeform).toHaveBeenCalledTimes(1);
  });

  it("mode-element 클릭이 핸들러로 전달된다", async () => {
    const h = handlers();
    render(<EmptyState {...h} unsupported={false} />);
    await userEvent.click(screen.getByTestId("mode-element"));
    expect(h.onStartElement).toHaveBeenCalledTimes(1);
  });
});

describe("EmptyState — 미지원 페이지 (unsupported=true)", () => {
  it("캡처 버튼 5개가 전부 사라진다 (replay-button 포함)", () => {
    render(<EmptyState {...handlers()} unsupported />);
    for (const id of CAPTURE_BUTTONS) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it("미지원 안내 제목·본문이 보인다", () => {
    render(<EmptyState {...handlers()} unsupported />);
    expect(screen.getByText("app.captureUnsupported.title")).toBeTruthy();
    expect(screen.getByText("app.captureUnsupported.body")).toBeTruthy();
  });

  // 기존 app.unsupported.* 는 "BugShot 전체를 못 쓴다"는 뜻이라 4개 탭 중 3개가 동작하는
  // 이 맥락과 어긋난다. 재사용하지 않는 결정을 잠근다.
  it("전체화면용 app.unsupported.* 문구를 재사용하지 않는다", () => {
    render(<EmptyState {...handlers()} unsupported />);
    expect(screen.queryByText("app.unsupported.title")).toBeNull();
    expect(screen.queryByText("app.unsupported.body")).toBeNull();
  });

  // [가이드]는 chrome.tabs.create라 페이지와 무관하게 동작한다 — 미지원 화면에서 유일하게
  // 남는 footer 액션이다.
  it("[가이드] 버튼은 그대로 보이고 클릭 가능하다", async () => {
    render(<EmptyState {...handlers()} unsupported />);
    const guide = screen.getByTestId("open-guide");
    expect(guide).toBeTruthy();
    await userEvent.click(guide);
    expect(chrome.tabs.create).toHaveBeenCalled();
  });

  // 지우지 않고 비활성으로 남긴다 — 미지원 페이지는 첫 실행 사용자가 가장 오래 머무는
  // 화면이라 버튼 자리를 미리 익히게 하는 편이 낫다는 제품 결정.
  it("[이슈 작성]은 남아 있되 aria-disabled이고 클릭해도 핸들러가 불리지 않는다", async () => {
    const h = handlers();
    render(<EmptyState {...h} unsupported />);
    const btn = screen.getByTestId("mode-freeform");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(btn);
    expect(h.onStartFreeform).not.toHaveBeenCalled();
  });

  // disabled 속성이면 shadcn Button base의 disabled:pointer-events-none이 hover·툴팁을 죽인다
  // (DESIGN.md §14). 나중에 이유를 툴팁으로 붙일 여지를 남기려면 aria-disabled여야 한다.
  it("disabled 속성이 아니라 aria-disabled를 쓴다", () => {
    render(<EmptyState {...handlers()} unsupported />);
    expect((screen.getByTestId("mode-freeform") as HTMLButtonElement).disabled).toBe(false);
  });

  it("연동 0개면 IntegrationsCta가 보인다 (첫 실행에서 완주 가능한 유일한 행동)", () => {
    accounts = {};
    render(<EmptyState {...handlers()} unsupported />);
    expect(screen.getByTestId("integrations-cta")).toBeTruthy();
  });

  it("연동 1개 이상이면 IntegrationsCta가 없다", () => {
    accounts = { github: { login: "octocat" } };
    render(<EmptyState {...handlers()} unsupported />);
    expect(screen.queryByTestId("integrations-cta")).toBeNull();
  });
});
