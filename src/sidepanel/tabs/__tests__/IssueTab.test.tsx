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

  it("[이슈 작성]이 보이고 클릭하면 핸들러가 호출된다", async () => {
    const h = handlers();
    render(<EmptyState {...h} unsupported={false} />);
    await userEvent.click(screen.getByTestId("mode-freeform"));
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

  // aria-disabled가 아니라 렌더 제외다 — 저장소의 aria-disabled 30+곳은 전부 transient busy
  // 잠금이고 영속적 환경 제약에 쓴 선례가 0곳이며, "회색 버튼이 섞인 화면이 더 헷갈린다"는
  // 대안 E 기각 근거와도 일관된다.
  it("[이슈 작성]은 DOM에서 제거된다 (aria-disabled가 아니라 렌더 제외)", () => {
    render(<EmptyState {...handlers()} unsupported />);
    expect(screen.queryByTestId("mode-freeform")).toBeNull();
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
