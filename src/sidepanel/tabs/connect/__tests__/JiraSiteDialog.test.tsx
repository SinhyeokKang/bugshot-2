import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JiraSiteDialog } from "../JiraConnectForm";

const SITES = [
  { id: "s1", name: "Acme", url: "https://acme.atlassian.net", avatarUrl: "" },
  { id: "s2", name: "Beta", url: "https://beta.atlassian.net", avatarUrl: "" },
];

function renderDialog(connecting: boolean, onSelect: () => void) {
  return render(
    <JiraSiteDialog
      open
      onOpenChange={() => {}}
      sites={SITES as never}
      connecting={connecting}
      onSelect={onSelect}
    />,
  );
}

// 순수 disabled는 클릭 자체가 안 들어오지만 aria-disabled는 들어온다 — 핸들러 가드가 짝이다.
// 가드를 빼먹으면 연결 중 재클릭이 두 번째 OAuth 사이트 선택을 중복 발화한다.
describe("JiraSiteDialog — 사이트 선택 중복 클릭 가드", () => {
  it("연결 중이 아니면 선택이 전달된다", async () => {
    const onSelect = vi.fn();
    renderDialog(false, onSelect);

    await userEvent.click(screen.getByText("Acme"));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("연결 중에는 재클릭해도 핸들러가 안 불린다", async () => {
    const onSelect = vi.fn();
    renderDialog(true, onSelect);

    await userEvent.click(screen.getByText("Acme"));
    await userEvent.click(screen.getByText("Beta"));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("연결 중 버튼은 aria-disabled를 노출한다 (순수 disabled 아님)", () => {
    renderDialog(true, vi.fn());

    const btn = screen.getByText("Acme").closest("button");
    expect(btn?.getAttribute("aria-disabled")).toBe("true");
    expect(btn?.hasAttribute("disabled")).toBe(false);
  });
});
