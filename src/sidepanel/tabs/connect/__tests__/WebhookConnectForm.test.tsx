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

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: unknown) => toastError(m), success: vi.fn() } }));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
  isOAuthCancelled: () => false,
  isOAuthNotConfigured: () => false,
}));

import { useSettingsStore } from "@/store/settings-store";
import type { WebhookAccount } from "@/types/webhook";
import { WebhookConnectEntry } from "../WebhookConnectForm";

const onConnected = vi.fn();

function account(auth: Partial<WebhookAccount["auth"]> = {}): WebhookAccount {
  return {
    platform: "webhook",
    connectedAt: 1,
    auth: { url: "https://hooks.example.com/bugshot", headers: [], format: "multipart", ...auth },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendBg.mockResolvedValue({});
  useSettingsStore.setState({ accounts: {} });
});

async function openDialog() {
  const user = userEvent.setup();
  render(<WebhookConnectEntry onConnected={onConnected} />);
  await user.click(screen.getByTestId("webhook-connect-entry"));
  await screen.findByTestId("webhook-url");
  return user;
}

describe("WebhookConnectForm — 기본 화면", () => {
  it("입력 칸이 Endpoint·Secret 둘뿐이다", async () => {
    await openDialog();
    expect(screen.getByTestId("webhook-url")).toBeTruthy();
    expect(screen.getByTestId("webhook-secret")).toBeTruthy();
    expect(screen.queryByTestId("webhook-format")).toBeNull();
    expect(screen.queryByTestId("webhook-header-row")).toBeNull();
    expect(screen.queryByTestId("webhook-template")).toBeNull();
  });

  it("고급을 펴면 Format·헤더 행이 나온다", async () => {
    const user = await openDialog();
    await user.click(screen.getByTestId("webhook-advanced-toggle"));
    expect(await screen.findByTestId("webhook-format")).toBeTruthy();
    expect(screen.getAllByTestId("webhook-header-row").length).toBeGreaterThan(0);
  });

  // 편집 진입에서 고급이 닫혀 있으면 저장돼 있던 헤더·템플릿이 사라진 것처럼 보인다.
  it("헤더를 든 계정을 다시 열면 고급이 펼쳐진 채로 뜬다", async () => {
    useSettingsStore.setState({
      accounts: { webhook: account({ headers: [{ name: "X-Team", value: "web" }] }) },
    });
    await openDialog();
    expect(screen.getByTestId("webhook-format")).toBeTruthy();
    expect(screen.getByDisplayValue("X-Team")).toBeTruthy();
  });

  it("json 계정을 다시 열면 고급이 펼쳐진 채로 뜬다", async () => {
    useSettingsStore.setState({
      accounts: { webhook: account({ format: "json", template: '{"t":"{{title}}"}' }) },
    });
    await openDialog();
    expect(screen.getByTestId("webhook-template")).toBeTruthy();
  });

  it("저장된 계정의 endpoint·secret을 폼이 그대로 물고 연다", async () => {
    useSettingsStore.setState({ accounts: { webhook: account({ secret: "s3cr3t-value" }) } });
    await openDialog();
    expect((screen.getByTestId("webhook-url") as HTMLInputElement).value).toBe(
      "https://hooks.example.com/bugshot",
    );
    expect((screen.getByTestId("webhook-secret") as HTMLInputElement).value).toBe("s3cr3t-value");
  });
});

describe("WebhookConnectForm — 저장 게이트", () => {
  it("공인망 http는 저장되지 않고 사유가 뜬다", async () => {
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "http://hooks.example.com/bugshot");
    await user.click(screen.getByTestId("webhook-save"));
    expect(useSettingsStore.getState().accounts.webhook).toBeUndefined();
    expect(await screen.findByTestId("webhook-form-error")).toBeTruthy();
  });

  it("사설망 http는 경고를 띄우고 저장은 된다", async () => {
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "http://192.168.0.7:9000/hook");
    expect(await screen.findByTestId("webhook-plaintext-warning")).toBeTruthy();
    await user.click(screen.getByTestId("webhook-save"));
    await waitFor(() =>
      expect(useSettingsStore.getState().accounts.webhook?.auth.url).toBe(
        "http://192.168.0.7:9000/hook",
      ),
    );
  });

  it("forbidden 헤더 이름은 저장을 막고 사유를 보여준다", async () => {
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "https://hooks.example.com/bugshot");
    await user.click(screen.getByTestId("webhook-advanced-toggle"));
    const rows = await screen.findAllByTestId("webhook-header-row");
    await user.type(rows[0].querySelector("input")!, "Cookie");
    await user.click(screen.getByTestId("webhook-save"));
    expect(useSettingsStore.getState().accounts.webhook).toBeUndefined();
    expect((await screen.findByTestId("webhook-form-error")).textContent).toContain("Cookie");
  });

  it("Secret만 채워 저장하면 headers가 빈 배열로 저장된다", async () => {
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "https://hooks.example.com/bugshot");
    await user.type(screen.getByTestId("webhook-secret"), "s3cr3t-value");
    await user.click(screen.getByTestId("webhook-save"));
    await waitFor(() => {
      const auth = useSettingsStore.getState().accounts.webhook?.auth;
      expect(auth?.secret).toBe("s3cr3t-value");
      expect(auth?.headers).toEqual([]);
    });
    expect(onConnected).toHaveBeenCalled();
  });
});

describe("WebhookConnectForm — 연결 테스트", () => {
  it("성공해도 저장은 별개다 — 테스트만으로 계정이 생기지 않는다", async () => {
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "https://hooks.example.com/bugshot");
    await user.click(screen.getByTestId("webhook-test"));
    await waitFor(() => expect(sendBg).toHaveBeenCalled());
    expect(sendBg.mock.calls[0][0]).toMatchObject({ type: "webhook.test" });
    expect(useSettingsStore.getState().accounts.webhook).toBeUndefined();
  });

  it("테스트가 실패하면 계정을 저장하지 않는다", async () => {
    sendBg.mockRejectedValue(new Error("boom"));
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "https://hooks.example.com/bugshot");
    await user.click(screen.getByTestId("webhook-test"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(useSettingsStore.getState().accounts.webhook).toBeUndefined();
  });

  it("URL이 정책에 걸리면 테스트 요청 자체를 보내지 않는다", async () => {
    const user = await openDialog();
    await user.type(screen.getByTestId("webhook-url"), "http://hooks.example.com/bugshot");
    await user.click(screen.getByTestId("webhook-test"));
    expect(sendBg).not.toHaveBeenCalled();
    expect(await screen.findByTestId("webhook-form-error")).toBeTruthy();
  });
});
