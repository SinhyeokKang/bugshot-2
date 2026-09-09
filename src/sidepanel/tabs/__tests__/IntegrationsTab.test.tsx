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

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
  isOAuthCancelled: () => false,
  isOAuthNotConfigured: () => false,
}));

import { useSettingsStore } from "@/store/settings-store";
import { IntegrationsTab } from "../IntegrationsTab";

const onReconnectHandled = vi.fn();

// projectKey를 비워두면 JiraConnectedBody의 SetupDialog가 스스로 열리고, 그 모달이 바깥
// 트리를 aria-hidden으로 덮어 role 조회가 전부 실종된다(테스트 환경 한정 함정이 아니라
// 실제 UX와 같은 동작이다 — 설정이 덜 된 계정이면 안내 모달이 먼저 뜬다).
function jiraAccount() {
  return {
    platform: "jira" as const,
    connectedAt: 1,
    projectKey: "WEB",
    issueTypeId: "10004",
    auth: {
      kind: "oauth" as const,
      cloudId: "cid",
      siteUrl: "https://x.atlassian.net",
      email: "u@x.com",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3_600_000,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendBg.mockResolvedValue({ available: true });
  useSettingsStore.setState({ accounts: { jira: jiraAccount() } });
});

describe("IntegrationsTab — 재연동 intent 수신", () => {
  // 연결이 1개라도 있으면 기존 진입 규칙이 '내 연동'을 고른다. 재연동 버튼은 '플랫폼 추가'
  // 목록에 있으므로, intent가 그 규칙을 이기지 않으면 사용자가 서브탭을 손으로 옮겨야 한다.
  it("intent를 받으면 '플랫폼 추가' 서브탭으로 전환한다", async () => {
    const { rerender } = render(
      <IntegrationsTab
        activeMainTab="integrations"
        reconnectPlatform={null}
        onReconnectHandled={onReconnectHandled}
      />,
    );
    expect(
      screen.getByRole("tab", { name: /subtab.connected/ }).getAttribute("aria-selected"),
    ).toBe("true");

    rerender(
      <IntegrationsTab
        activeMainTab="integrations"
        reconnectPlatform="jira"
        onReconnectHandled={onReconnectHandled}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /subtab.add/ }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });

  // intent를 8개 셸 전부에 흘리면 OAuth 창 8개가 동시에 뜬다. autoStart는 지목된 하나만.
  it("intent가 지목한 플랫폼만 스스로 열린다", async () => {
    render(
      <IntegrationsTab
        activeMainTab="integrations"
        reconnectPlatform="jira"
        onReconnectHandled={onReconnectHandled}
      />,
    );

    // 수단 선택 다이얼로그의 제목만 센다 — 이 화면엔 다른 모달도 살 수 있어서
    // role=dialog 개수로는 "지목된 하나만 열렸다"를 못 가린다.
    // body.textContent는 노드 경계 없이 이어붙어 다음 문구까지 물고 온다 — 제목 엘리먼트를
    // 직접 세야 "몇 개 열렸는지"와 "어느 플랫폼인지"가 따로 잡힌다.
    await waitFor(() =>
      expect(
        screen.getAllByText(/^platform\.connectMethod\.reconnectTitle:/),
      ).toHaveLength(1),
    );
    expect(
      screen.getByText(/^platform\.connectMethod\.reconnectTitle:/).textContent,
    ).toBe("platform.connectMethod.reconnectTitle:platform.tab.jira");
  });

  it("소비하면 부모에게 알려 intent를 지우게 한다", async () => {
    render(
      <IntegrationsTab
        activeMainTab="integrations"
        reconnectPlatform="jira"
        onReconnectHandled={onReconnectHandled}
      />,
    );

    await waitFor(() =>
      expect(onReconnectHandled).toHaveBeenCalledTimes(1),
    );
  });

  it("intent가 없으면 아무 셸도 스스로 열지 않는다", async () => {
    render(
      <IntegrationsTab
        activeMainTab="integrations"
        reconnectPlatform={null}
        onReconnectHandled={onReconnectHandled}
      />,
    );

    // '내 연동'에 머무는 동안 add 탭 컨텐츠는 Radix가 언마운트한 상태다 — 셸이 아직 없으니
    // oauth.available조차 안 나간다. 그래서 sendBg 호출을 기다리지 않고 서브탭으로 잰다.
    // (다이얼로그 부재는 그 언마운트 때문에 구조적으로 참이라 재지 않는다.)
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /subtab.connected/ }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(onReconnectHandled).not.toHaveBeenCalled();
  });

  // 셸이 열리기 전에 사용자가 자리를 옮기면 셸이 언마운트돼 intent가 미소비로 남고, 그러면
  // 다음 connectedCount 변화가 사용자를 "add"로 되돌린다. 이동 시점에 소비 처리한다.
  it("서브탭을 손으로 옮기면 intent를 소비한다", async () => {
    // 수단 판정이 끝나기 전 = 셸이 아직 아무것도 안 연 구간. 이 픽스가 겨냥한 창이고,
    // 다이얼로그가 없어야 탭 트리거 클릭이 오버레이에 막히지 않는다.
    sendBg.mockReturnValue(new Promise(() => {}));
    render(
      <IntegrationsTab
        activeMainTab="integrations"
        reconnectPlatform="jira"
        onReconnectHandled={onReconnectHandled}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /subtab.add/ }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    onReconnectHandled.mockClear();

    await userEvent.click(screen.getByRole("tab", { name: /subtab.connected/ }));

    expect(onReconnectHandled).toHaveBeenCalled();
  });
});
