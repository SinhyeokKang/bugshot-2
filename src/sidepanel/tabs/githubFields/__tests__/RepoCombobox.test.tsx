import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubRepo } from "@/types/github";
import { RepoCombobox } from "../RepoCombobox";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const { sendBg } = vi.hoisted(() => ({ sendBg: vi.fn() }));
vi.mock("@/lib/bg-client", () => ({ sendBg }));

const repo = (over: Partial<GithubRepo> = {}): GithubRepo => ({
  id: 1,
  nodeId: "n",
  owner: "o",
  name: "r",
  fullName: "o/r",
  private: false,
  htmlUrl: "x",
  hasIssues: true,
  archived: false,
  ...over,
});

beforeEach(() => {
  sendBg.mockReset();
});

// 팝오버가 열리면 cmdk의 CommandInput도 role="combobox"를 갖는다.
function trigger(): HTMLElement {
  const found = screen
    .getAllByRole("combobox")
    .find((el) => el.tagName === "BUTTON");
  if (!found) throw new Error("트리거 버튼을 찾지 못했다");
  return found;
}

async function openWith(items: GithubRepo[]) {
  sendBg.mockResolvedValue(items);
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<RepoCombobox value={null} onChange={onChange} />);
  await user.click(trigger());
  return { user, onChange };
}

describe("githubFields/RepoCombobox — 이슈를 못 여는 repo", () => {
  it("이슈 탭이 꺼진 repo는 배지를 달고 선택 불가로 표시된다", async () => {
    const { onChange } = await openWith([
      repo({ fullName: "acme/no-issues", hasIssues: false }),
    ]);

    const item = await screen.findByRole("option", { name: /acme\/no-issues/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("github.field.repo.issuesOff");
    expect(onChange).not.toHaveBeenCalled();
  });

  // 배지 문구가 두 사유를 구분하지 않으면 사용자가 왜 못 고르는지 알 수 없다.
  it("보관된 repo는 이슈 탭이 켜져 있어도 보관 배지를 단다", async () => {
    await openWith([
      repo({ fullName: "acme/archived", hasIssues: true, archived: true }),
    ]);

    const item = await screen.findByRole("option", { name: /acme\/archived/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("github.field.repo.archived");
    expect(item.textContent).not.toContain("github.field.repo.issuesOff");
  });

  it("이슈를 열 수 있는 repo는 배지 없이 선택된다", async () => {
    const { user, onChange } = await openWith([
      repo({ owner: "acme", name: "ok", fullName: "acme/ok" }),
    ]);

    const item = await screen.findByRole("option", { name: /acme\/ok/ });
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    expect(item.textContent).not.toContain("github.field.repo.archived");
    expect(item.textContent).not.toContain("github.field.repo.issuesOff");

    await user.click(item);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ owner: "acme", repo: "ok" }),
    );
  });
});
