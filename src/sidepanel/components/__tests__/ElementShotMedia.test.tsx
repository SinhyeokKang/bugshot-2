// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ElementShotMedia } from "../ElementShotMedia";
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@/sidepanel/lib/downloadCapture", () => ({ downloadImageDataUrl: vi.fn() }));
afterEach(cleanup);

it("renders duplicate images in order, routes actions by ID and moves focus after deletion", () => {
  const onDelete = vi.fn();
  const onEdit = vi.fn();
  render(<ElementShotMedia items={[{ id: "a", url: "same" }, { id: "b", url: "same" }]} onDelete={onDelete} onEdit={onEdit} />);
  expect(screen.getAllByRole("img").map(img => img.getAttribute("src"))).toEqual(["same", "same"]);
  fireEvent.click(screen.getAllByTestId("annotation-edit")[1]);
  expect(onEdit).toHaveBeenCalledWith("b");
  fireEvent.click(screen.getAllByTestId("element-shot-delete")[0]);
  expect(onDelete).toHaveBeenCalledWith("a");
  expect(document.activeElement).toBe(screen.getAllByTestId("annotation-edit")[1]);
});

it("hides final deletion and exposes unavailable media without silently dropping its slot", () => {
  render(<ElementShotMedia items={[{ id: "a", url: null }]} onDelete={vi.fn()} />);
  expect(screen.queryByTestId("element-shot-delete")).toBeNull();
  expect(screen.getByText("recovery.localMissing")).toBeTruthy();
  expect(screen.getByTestId("element-shot-item").dataset.shotId).toBe("a");
});

it("blocks every media mutation while an acknowledged save is pending", () => {
  const edit = vi.fn();
  const reset = vi.fn();
  const remove = vi.fn();
  render(<ElementShotMedia busy items={[{ id: "a", url: "a", annotated: true }, { id: "b", url: "b" }]}
    onEdit={edit} onReset={reset} onDelete={remove} />);
  fireEvent.click(screen.getAllByTestId("annotation-edit")[0]);
  fireEvent.click(screen.getByTestId("annotation-remove"));
  fireEvent.click(screen.getAllByTestId("element-shot-delete")[0]);
  expect(edit).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
