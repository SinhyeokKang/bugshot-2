import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LinearIssueFields } from "../LinearIssueFields";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("@/lib/bg-client", () => ({ sendBg: vi.fn().mockResolvedValue([]) }));

describe("LinearIssueFields priority label", () => {
  it("names each priority control and focuses the matching instance on label click", async () => {
    render(<><LinearIssueFields value={{}} onChange={vi.fn()} /><LinearIssueFields value={{ priority: 2 }} onChange={vi.fn()} /></>);
    const controls = screen.getAllByRole("combobox", { name: "linear.field.priority", exact: true });
    const labels = screen.getAllByText("linear.field.priority", { selector: "label" });
    expect(controls).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(screen.getAllByLabelText("linear.field.priority")[i]).toBe(controls[i]);
      await userEvent.click(labels[i]);
      expect(document.activeElement).toBe(controls[i]);
    }
  });
});
