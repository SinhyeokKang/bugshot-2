import { readFileSync, readdirSync } from "node:fs";
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
// 문제는 셸·래퍼가 늘어날 때다. 여기서 목록을 손으로 적으면 안 된다 — 첫 시도가 정확히 그래서
// SlackConnectForm(세 번째 셸)을 통째로 빠뜨렸고, `ConnectFlow:` 항목 수만 세던 단언이 공허하게
// 통과했다. 그래서 디렉터리를 훑어 "자체 셸"과 "공용 셸 래퍼"로 **파생**한다.
describe("연결 버튼 규칙의 전수 (셸·래퍼 파생)", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const forms = readdirSync(dir).filter((f) => f.endsWith("ConnectForm.tsx"));
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  // 공용 셸에 위임하는 래퍼와, 자기 버튼을 직접 그리는 셸을 파일 내용으로 가른다.
  const wrappers = forms.filter((f) => read(f).includes("<PlatformConnectFlow"));
  const ownShells = ["PlatformConnectFlow.tsx", ...forms.filter((f) => !wrappers.includes(f))];

  // 파생이 무너지면(예: 파일명 규칙 변경) 아래 루프가 조용히 0건을 돈다.
  it("파생이 실제 파일을 집었다 (자기검증 앵커)", () => {
    expect(forms.length).toBe(8);
    expect(wrappers.length).toBe(6);
    expect(ownShells).toEqual([
      "PlatformConnectFlow.tsx",
      "JiraConnectForm.tsx",
      "SlackConnectForm.tsx",
    ]);
    expect(read("PlatformConnectFlow.tsx")).toContain(
      "export function PlatformConnectFlow",
    );
  });

  it("어느 셸도 connected를 disabled 근거로 쓰지 않는다", () => {
    for (const shell of ownShells) {
      expect(read(shell), shell).not.toContain("disabled={connected");
    }
  });

  it("모든 셸이 재연동 라벨과 autoStart 소비를 든다", () => {
    for (const shell of ownShells) {
      expect(read(shell), shell).toContain("platform.reconnect");
      // prop을 받는 것만으론 부족하다 — 구조분해만 하고 안 쓰면 intent가 미소비로 고착된다.
      expect(read(shell), shell).toContain("useAutoStart({");
    }
  });

  // 재연동은 계정 교체라 파괴적이다. 수단 선택 다이얼로그를 지나지 않는 분기(토큰 직행 ·
  // 수단 선택이 아예 없는 Slack)는 확인을 스스로 세워야 한다.
  it("모든 셸이 재연동 확인 게이트를 든다", () => {
    for (const shell of ownShells) {
      expect(read(shell), shell).toContain("ReconnectConfirmDialog");
    }
  });

  // 래퍼가 전달을 빠뜨리면 그 플랫폼만 재연동이 죽는다. ConnectFlowProps가 required라
  // typecheck가 1차로 잡지만, 값을 상수로 넣어도 통과하므로 실제 prop 배선을 여기서 본다.
  it("6개 래퍼가 intent를 공용 셸로 그대로 흘린다", () => {
    for (const wrapper of wrappers) {
      const source = read(wrapper);
      expect(source, wrapper).toContain("autoStart={autoStart}");
      expect(source, wrapper).toContain("onAutoStartHandled={onAutoStartHandled}");
    }
  });
});
