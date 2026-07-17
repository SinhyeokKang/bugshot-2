import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocSectionBody } from "../DocSectionBody";
import type { IssueSection } from "@/store/settings-ui-store";

// 키 반환 모킹 — 실제 ko/en 문구는 locales.test.ts와 e2e가 맡는다. 모킹을 빼면 useT가
// useSettingsUiStore(zustand persist)를 구독해 chrome.storage에 닿는다. 줄 수도 라벨이
// 아니라 data-lines로 잡는다 — 키 모킹 하에선 {count} 보간이 안 일어난다.
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/store/blob-db", () => ({
  getInlineImage: vi.fn(async () => null),
}));

const SECTION: IssueSection = {
  id: "description",
  enabled: true,
  renderAs: "paragraph",
  builtIn: true,
};

function codeBlock(lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
  return `\`\`\`\n${body}\n\`\`\``;
}

function renderBody(value: string) {
  return render(<DocSectionBody section={SECTION} value={value} />);
}

describe("DocSectionBody — 코드블럭 접기", () => {
  it("16줄 이상 블럭은 접힌 채로 렌더되고 pill이 전체 줄 수를 담는다", () => {
    renderBody(codeBlock(20));

    const wrapper = screen.getByTestId("code-collapse");
    expect(wrapper.getAttribute("data-collapsible")).toBe("true");
    expect(wrapper.getAttribute("data-collapsed")).toBe("true");

    const toggle = screen.getByTestId("code-collapse-toggle");
    expect(toggle.getAttribute("data-lines")).toBe("20");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("pill을 클릭하면 그 블럭이 펼쳐진다", async () => {
    const user = userEvent.setup();
    renderBody(codeBlock(20));

    await user.click(screen.getByTestId("code-collapse-toggle"));

    expect(screen.getByTestId("code-collapse").getAttribute("data-collapsed")).toBe("false");
    const toggle = screen.getByTestId("code-collapse-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("codeBlock.collapse");
  });

  it("다시 클릭하면 접힌다", async () => {
    const user = userEvent.setup();
    renderBody(codeBlock(20));

    await user.click(screen.getByTestId("code-collapse-toggle"));
    await user.click(screen.getByTestId("code-collapse-toggle"));

    expect(screen.getByTestId("code-collapse").getAttribute("data-collapsed")).toBe("true");
  });

  it("15줄 이하 블럭은 접히지 않는다", () => {
    renderBody(codeBlock(10));

    expect(screen.getByTestId("code-collapse").getAttribute("data-collapsible")).toBe("false");
  });

  it("정확히 15줄은 안 접히고 16줄은 접힌다", () => {
    const { unmount } = renderBody(codeBlock(15));
    expect(screen.getByTestId("code-collapse").getAttribute("data-collapsible")).toBe("false");
    unmount();

    renderBody(codeBlock(16));
    expect(screen.getByTestId("code-collapse").getAttribute("data-collapsible")).toBe("true");
  });

  // 두 진입점(main.tsx)이 StrictMode다. mount→cleanup→mount는 innerHTML을 재설정하지
  // 않으므로 셸 부착이 자기 출력에 대해 idempotent해야 한다 — prod 재실행 경로의 리허설.
  it("StrictMode 이중 마운트에도 셸이 1겹이고 pill이 살아 있다", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <DocSectionBody section={SECTION} value={codeBlock(20)} />
      </StrictMode>,
    );

    expect(screen.getAllByTestId("code-collapse")).toHaveLength(1);
    expect(screen.getAllByTestId("code-collapse-toggle")).toHaveLength(1);

    await user.click(screen.getByTestId("code-collapse-toggle"));

    expect(screen.getByTestId("code-collapse").getAttribute("data-collapsed")).toBe("false");
  });

  it("코드블럭 2개는 각각 독립적으로 토글되고 aria-controls가 자기 pre를 가리킨다", async () => {
    const user = userEvent.setup();
    renderBody(`${codeBlock(20)}\n\n사이 문단\n\n${codeBlock(18)}`);

    const wrappers = screen.getAllByTestId("code-collapse");
    const toggles = screen.getAllByTestId("code-collapse-toggle");
    expect(wrappers).toHaveLength(2);

    const preIds = wrappers.map((w) => w.querySelector("pre")!.id);
    expect(preIds[0]).not.toBe(preIds[1]);
    expect(toggles[0].getAttribute("aria-controls")).toBe(preIds[0]);
    expect(toggles[1].getAttribute("aria-controls")).toBe(preIds[1]);

    await user.click(toggles[0]);

    expect(wrappers[0].getAttribute("data-collapsed")).toBe("false");
    expect(wrappers[1].getAttribute("data-collapsed")).toBe("true");
  });
});
