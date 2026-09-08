import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  t: (key: string) => key,
}));

import { OAuthExpiredDialog } from "../OAuthExpiredDialog";

const onOpenChange = vi.fn();
const onReconnect = vi.fn();

// 만료 안내가 [확인] → 연동 탭 이동까지만 하던 게 문제의 절반이었다. 그 탭에서도 연결된
// 플랫폼 행에는 해제 버튼만 있어, 사용자는 **해제부터** 하고 다시 연결해야 했다. 안내가
// 재연동 자체를 실행 지점으로 들고 있어야 그 왕복이 없어진다.
function renderDialog(platform: "jira" | null = "jira") {
  return render(
    <OAuthExpiredDialog
      platform={platform}
      onOpenChange={onOpenChange}
      onReconnect={onReconnect}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OAuthExpiredDialog", () => {
  it("platform이 null이면 열리지 않는다", () => {
    renderDialog(null);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("어느 플랫폼이 만료됐는지 제목·본문에 싣는다", () => {
    renderDialog();

    expect(screen.getByRole("alertdialog").textContent).toContain(
      "platform.oauthExpired.title:platform.tab.jira",
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "platform.oauthExpired.body:platform.tab.jira",
    );
  });

  it("[다시 연결]은 만료된 플랫폼을 실어 재연동을 요청한다", async () => {
    renderDialog();

    await userEvent.click(
      screen.getByRole("button", { name: /oauthExpired.reconnect/ }),
    );

    expect(onReconnect).toHaveBeenCalledWith("jira");
  });

  // 닫기가 재연동까지 발화하면 사용자가 안내를 무시할 방법이 없어진다.
  it("닫기는 재연동을 발화하지 않고 닫는다", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: /common.close/ }));

    expect(onReconnect).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
