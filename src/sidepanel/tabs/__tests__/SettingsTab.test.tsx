import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SettingsTab } from "../SettingsTab";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("@/lib/bg-client", () => ({ sendBg: vi.fn().mockResolvedValue({}) }));

it("names the title prefix input and focuses it when its visible label is clicked", async () => {
  render(<SettingsTab sub="issue" onSubChange={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "settings.titlePrefix.label" });
  expect(screen.getByLabelText("settings.titlePrefix.label")).toBe(input);
  await userEvent.click(screen.getByText("settings.titlePrefix.label", { selector: "label" }));
  expect(document.activeElement).toBe(input);
});
