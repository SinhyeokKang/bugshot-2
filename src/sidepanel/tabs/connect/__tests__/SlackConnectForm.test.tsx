import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
  isOAuthCancelled: () => false,
}));

import { SlackConnectFlow } from "../SlackConnectForm";

const onConnected = vi.fn();
const onAutoStartHandled = vi.fn();

// Slack은 세 번째 셸이다 — 공용 셸도 Jira 셸도 아니고 **수단 선택 다이얼로그가 없다**(OAuth
// 전용). 그래서 형제에게 있는 불변식이 여기선 구조적으로 다르게 성립하고, 전수 스캔이
// Slack을 사정거리에 넣은 뒤에도 행동 축은 이 파일이 유일한 그물이다.
function renderFlow(connected = false, autoStart = false) {
  return render(
    <SlackConnectFlow
      connected={connected}
      onConnected={onConnected}
      autoStart={autoStart}
      onAutoStartHandled={onAutoStartHandled}
    />,
  );
}

function availableResolves(available: boolean) {
  sendBg.mockImplementation((req: { type: string }) =>
    req.type === "slack.oauth.available"
      ? Promise.resolve({ available })
      : Promise.resolve({ auth: {}, teamId: "T1", teamName: "Acme" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SlackConnectFlow — 재연동 진입점", () => {
  it("이미 연결됐으면 버튼이 활성이고 재연동 문구가 뜬다", async () => {
    availableResolves(true);
    renderFlow(true);

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toContain(
        "platform.reconnect",
      ),
    );
    expect(screen.getByRole("button")).not.toHaveProperty("disabled", true);
  });

  it("가용성 조회 중에는 disabled다", () => {
    sendBg.mockReturnValue(new Promise(() => {}));
    renderFlow(true);

    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  // 형제 셸은 수단 선택 다이얼로그가 초기화 안내를 들지만 Slack엔 그게 없다 — 확인이
  // 없으면 클릭 한 번에 계정이 교체된다(기본 채널·직전 제출값 소실).
  it("연결된 상태의 클릭은 OAuth 대신 확인을 먼저 세운다", async () => {
    availableResolves(true);
    renderFlow(true);
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("alertdialog").textContent).toContain(
      "platform.reconnect.note",
    );
    expect(sendBg.mock.calls.some(([r]) => r.type === "slack.startOAuth")).toBe(
      false,
    );
  });

  it("확인하면 그때 OAuth가 나간다", async () => {
    availableResolves(true);
    renderFlow(true);
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );
    await userEvent.click(screen.getByRole("button"));

    await userEvent.click(
      screen.getByRole("button", { name: /platform.reconnect.confirm/ }),
    );

    await waitFor(() =>
      expect(sendBg).toHaveBeenCalledWith({ type: "slack.startOAuth" }),
    );
  });

  // 미연결(최초 연결)은 잃을 설정이 없으므로 확인 없이 곧장 OAuth다.
  it("미연결 클릭은 확인 없이 OAuth로 간다", async () => {
    availableResolves(true);
    renderFlow(false);
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );

    await userEvent.click(screen.getByRole("button"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(sendBg).toHaveBeenCalledWith({ type: "slack.startOAuth" }),
    );
  });

  it("autoStart는 OAuth를 발화하지 않고 확인만 연다", async () => {
    availableResolves(true);
    renderFlow(true, true);

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    expect(onAutoStartHandled).toHaveBeenCalledTimes(1);
    expect(sendBg.mock.calls.some(([r]) => r.type === "slack.startOAuth")).toBe(
      false,
    );
  });

  // Slack만 가용성이 거짓으로 **확정**될 수 있다(형제는 connectMethods가 ["token"]으로
  // 수렴한다). 그때 소비하지 않으면 intent가 영영 남아 연동 탭 서브탭이 "add"에 고착된다.
  it("OAuth가 불가하면 열지 않되 intent는 소비한다", async () => {
    availableResolves(false);
    renderFlow(true, true);

    await waitFor(() => expect(onAutoStartHandled).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });
});
