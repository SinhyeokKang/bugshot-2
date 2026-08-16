import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  t: (key: string) => key,
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

const sendBg = vi.fn();
let cancelled = false;
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
  isOAuthCancelled: () => cancelled,
}));

const setAccount = vi.fn();
vi.mock("@/store/settings-store", () => ({
  useSettingsStore: (sel: (s: { setAccount: typeof setAccount }) => unknown) =>
    sel({ setAccount }),
}));

import { PlatformConnectFlow } from "../PlatformConnectFlow";

const AVAILABLE = { type: "asana.oauth.available" } as const;
const START = { type: "asana.startOAuth" } as const;
const AUTH = { kind: "oauth", accessToken: "tok" };
// buildAccount가 실제로 불렸는지 보려고 셸이 만들 수 없는 표식을 심는다.
const ACCOUNT = { platform: "asana", connectedAt: 111, auth: AUTH, defaults: {} };

const onConnected = vi.fn();
const buildAccount = vi.fn(() => ACCOUNT);

function renderFlow(connected = false) {
  return render(
    <PlatformConnectFlow
      connected={connected}
      onConnected={onConnected}
      platform="asana"
      icon={<svg data-testid="platform-icon" />}
      tokenLabelKey="asana.patButton"
      availableRequest={AVAILABLE as never}
      startOAuthRequest={START as never}
      buildAccount={buildAccount as never}
      renderTokenDialog={({ open }) =>
        open ? <div data-testid="token-dialog" /> : null
      }
    />,
  );
}

/** oauth.available 응답을 정해두고 그 조회가 끝날 때까지 기다린다. */
async function settleAvailability(available: boolean) {
  sendBg.mockImplementation((req: { type: string }) =>
    req.type === AVAILABLE.type
      ? Promise.resolve({ available })
      : Promise.resolve(AUTH),
  );
  renderFlow();
  await waitFor(() =>
    expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelled = false;
});

describe("PlatformConnectFlow — 연결 수단 판정", () => {
  it("oauth.available 조회 중에는 버튼이 disabled다", () => {
    sendBg.mockReturnValue(new Promise(() => {}));
    renderFlow();

    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("이미 연결됐으면 버튼이 disabled고 connected 문구가 뜬다", async () => {
    sendBg.mockResolvedValue({ available: true });
    renderFlow(true);

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toContain(
        "platform.connected",
      ),
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("OAuth가 없으면 클릭 시 토큰 다이얼로그로 직행한다", async () => {
    await settleAvailability(false);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("token-dialog")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("OAuth가 있으면 클릭 시 수단 선택 다이얼로그가 먼저 열린다", async () => {
    await settleAvailability(true);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByTestId("token-dialog")).toBeNull();
  });

  it("수단 선택에서 토큰을 고르면 토큰 다이얼로그가 열린다", async () => {
    await settleAvailability(true);
    await userEvent.click(screen.getByRole("button"));

    await userEvent.click(screen.getByRole("button", { name: /patButton/ }));

    expect(screen.getByTestId("token-dialog")).toBeTruthy();
  });
});

describe("PlatformConnectFlow — OAuth 실행", () => {
  async function chooseOAuth() {
    await settleAvailability(true);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: /connectMethod.oauth/ }),
    );
  }

  it("startOAuth 요청 객체를 그대로 sendBg에 넘긴다", async () => {
    await chooseOAuth();

    await waitFor(() => expect(sendBg).toHaveBeenCalledWith(START));
  });

  // 셸이 계정을 직접 조립하면 excess property check가 사라진다(POSTMORTEM 2026-08-14).
  // 조립은 호출부 리터럴에 남기고 셸은 그 결과를 그대로 저장하는지만 본다.
  it("buildAccount가 만든 객체를 그대로 setAccount에 넘긴다", async () => {
    await chooseOAuth();

    await waitFor(() => expect(buildAccount).toHaveBeenCalledWith(AUTH));
    expect(setAccount).toHaveBeenCalledWith("asana", ACCOUNT);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("진행 중에는 aria-disabled + 스피너가 뜬다", async () => {
    sendBg.mockImplementation((req: { type: string }) =>
      req.type === AVAILABLE.type
        ? Promise.resolve({ available: true })
        : new Promise(() => {}),
    );
    const { container } = renderFlow();
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: /connectMethod.oauth/ }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button").getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("실패하면 toast로 알린다", async () => {
    sendBg.mockImplementation((req: { type: string }) =>
      req.type === AVAILABLE.type
        ? Promise.resolve({ available: true })
        : Promise.reject(new Error("boom")),
    );
    renderFlow();
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: /connectMethod.oauth/ }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
    expect(setAccount).not.toHaveBeenCalled();
  });

  // 창을 닫아 취소한 경우까지 에러 토스트를 띄우면 정상 이탈이 실패로 보인다.
  it("사용자 취소는 toast를 띄우지 않는다", async () => {
    cancelled = true;
    sendBg.mockImplementation((req: { type: string }) =>
      req.type === AVAILABLE.type
        ? Promise.resolve({ available: true })
        : Promise.reject(new Error("user closed")),
    );
    renderFlow();
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: /connectMethod.oauth/ }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button").getAttribute("aria-disabled"),
      ).not.toBe("true"),
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(setAccount).not.toHaveBeenCalled();
  });
});
