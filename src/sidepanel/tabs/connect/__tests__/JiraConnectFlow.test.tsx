import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

import { JiraConnectFlow } from "../JiraConnectForm";

const onConnected = vi.fn();
const onAutoStartHandled = vi.fn();

// Jira는 사이트 선택 때문에 공용 셸(PlatformConnectFlow)을 쓰지 않고 자체 셸을 든다. 그래서
// 버튼 게이트·autoStart 규칙이 **두 파일에 복제**돼 있고, 한쪽만 되돌려도 나머지 테스트는
// green이다. 여기가 Jira 쪽 복제분의 그물이다(사이트 선택 분기 자체는 JiraSiteDialog.test).
function renderFlow(connected = false, autoStart = false) {
  return render(
    <JiraConnectFlow
      connected={connected}
      onConnected={onConnected}
      autoStart={autoStart}
      onAutoStartHandled={onAutoStartHandled}
    />,
  );
}

/** 공용 셸 테스트와 같은 이유 — 재렌더마다 새 참조가 내려오는 호출부 모양을 흉내낸다. */
function AutoStartParent({ tick }: { tick: number }) {
  return (
    <div data-tick={tick}>
      <JiraConnectFlow
        connected
        autoStart
        onConnected={onConnected}
        onAutoStartHandled={onAutoStartHandled}
      />
    </div>
  );
}

function availableResolves(available: boolean) {
  sendBg.mockImplementation((req: { type: string }) =>
    req.type === "oauth.available"
      ? Promise.resolve({ available })
      : Promise.resolve({ sites: [], accessToken: "", refreshToken: "", expiresAt: 0 }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("JiraConnectFlow — 재연동 진입점", () => {
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

  it("연결된 상태에서도 oauth.available 조회 중에는 disabled다", () => {
    sendBg.mockReturnValue(new Promise(() => {}));
    renderFlow(true);

    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("연결된 상태의 클릭도 미연결과 같은 수단 선택 다이얼로그로 간다", async () => {
    availableResolves(true);
    renderFlow(true);
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("autoStart면 수단 판정이 끝난 뒤 스스로 열리고 handled를 알린다", async () => {
    availableResolves(true);
    renderFlow(true, true);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(onAutoStartHandled).toHaveBeenCalledTimes(1);
  });

  it("autoStart가 아니면 스스로 열지 않는다", async () => {
    availableResolves(true);
    renderFlow(true);
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toHaveProperty("disabled", true),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onAutoStartHandled).not.toHaveBeenCalled();
  });

  it("부모가 리렌더해도 한 번만 발화한다", async () => {
    availableResolves(true);
    const { rerender } = render(<AutoStartParent tick={0} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    rerender(<AutoStartParent tick={1} />);
    rerender(<AutoStartParent tick={2} />);

    expect(onAutoStartHandled).toHaveBeenCalledTimes(1);
  });

  it("수단 판정 전에는 발화하지 않고 intent도 소비하지 않는다", async () => {
    let resolveAvailable: ((v: { available: boolean }) => void) | undefined;
    sendBg.mockImplementation((req: { type: string }) =>
      req.type === "oauth.available"
        ? new Promise<{ available: boolean }>((r) => {
            resolveAvailable = r;
          })
        : Promise.resolve({ sites: [] }),
    );
    renderFlow(true, true);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onAutoStartHandled).not.toHaveBeenCalled();

    resolveAvailable?.({ available: true });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(onAutoStartHandled).toHaveBeenCalledTimes(1);
  });
});

// 위 케이스들은 각 셸을 따로 재므로, 한쪽 셸에서 규칙이 빠져도 **그 셸의 케이스만** 빨개진다.
// 문제는 셸이 늘어날 때다(9번째 플랫폼이 또 자체 셸을 들면). 규칙이 두 파일에 복제돼 있다는
// 사실 자체를 한 자리에서 잠근다 — 지금 두 파일뿐이라는 것까지 포함해서.
describe("연결 버튼 게이트의 복제 (셸 2개)", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const shells = ["PlatformConnectFlow.tsx", "JiraConnectForm.tsx"] as const;

  it("두 셸 모두 connected를 disabled 근거로 쓰지 않는다", () => {
    for (const shell of shells) {
      const source = readFileSync(join(dir, shell), "utf8");
      expect(source).not.toContain("disabled={connected");
    }
  });

  it("두 셸 모두 재연동 라벨과 autoStart를 든다", () => {
    for (const shell of shells) {
      const source = readFileSync(join(dir, shell), "utf8");
      expect(source).toContain("platform.reconnect");
      expect(source).toContain("autoStart");
    }
  });

  // 위 두 단언은 "파일을 제대로 읽었다"는 전제에 걸려 있다 — 경로가 틀어지면 공허해진다.
  it("스캔 대상이 실제 셸 파일이다 (자기검증 앵커)", () => {
    expect(readFileSync(join(dir, shells[0]), "utf8")).toContain(
      "export function PlatformConnectFlow",
    );
    expect(readFileSync(join(dir, shells[1]), "utf8")).toContain(
      "export function JiraConnectFlow",
    );
  });

  // 셸이 늘면 위 루프가 새 파일을 안 보고 지나간다. 목록이 곧 전수라는 걸 강제한다.
  it("연결 버튼을 그리는 셸은 이 둘뿐이다", () => {
    const owners = readFileSync(
      join(dir, "..", "IntegrationsTab.tsx"),
      "utf8",
    ).match(/ConnectFlow: (\w+)/g);
    expect(owners).toHaveLength(8);
    // 7개는 공용 셸을 감싸고 Jira만 자체 셸이다 — 셋 이상으로 갈리면 여기서 걸린다.
    const wrappers = owners!.filter((o) => !o.includes("JiraConnectFlow"));
    expect(wrappers).toHaveLength(7);
  });
});
