// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ElementShotMedia } from "../ElementShotMedia";
import { elementShotImage } from "@/sidepanel/lib/elementShots";
import type { ElementShot } from "@/types/element-shot";
import type { EditorSnapshot } from "@/store/editor-store";
vi.mock("@/i18n", async importOriginal => ({
  ...await importOriginal<typeof import("@/i18n")>(),
  useT: () => (key: string) => key,
}));
vi.mock("@/sidepanel/lib/downloadCapture", () => ({ downloadImageUrl: vi.fn().mockResolvedValue(undefined) }));
afterEach(cleanup);

it("renders duplicate images in order, routes actions by ID and moves focus after deletion", () => {
  const onDelete = vi.fn();
  const onEdit = vi.fn();
  render(<ElementShotMedia items={[{ id: "a", url: "same" }, { id: "b", url: "same" }]} onDelete={onDelete} onEdit={onEdit} />);
  expect(screen.getAllByRole("img").map(img => img.getAttribute("src"))).toEqual(["same", "same"]);
  const cards = screen.getAllByTestId("element-shot-item");
  expect(screen.queryByTestId("annotation-edit")).toBeNull();
  fireEvent.pointerEnter(cards[1]);
  fireEvent.click(screen.getByTestId("annotation-edit"));
  expect(onEdit).toHaveBeenCalledWith("b");
  fireEvent.pointerEnter(screen.getAllByTestId("element-shot-item")[0]);
  fireEvent.click(screen.getAllByTestId("element-shot-delete")[0]);
  expect(onDelete).toHaveBeenCalledWith("a");
  expect(document.activeElement).toBe(cards[1]);
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
  fireEvent.pointerEnter(screen.getAllByTestId("element-shot-item")[0]);
  fireEvent.click(screen.getAllByTestId("annotation-edit")[0]);
  fireEvent.click(screen.getByTestId("annotation-remove"));
  fireEvent.pointerEnter(screen.getAllByTestId("element-shot-item")[0]);
  fireEvent.click(screen.getAllByTestId("element-shot-delete")[0]);
  expect(edit).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("resets only the selected image and preserves the shared action ordering", () => {
  const reset = vi.fn();
  render(<ElementShotMedia items={[{ id: "a", url: "a" }, { id: "b", url: "b", annotated: true }]}
    onEdit={vi.fn()} onReset={reset} onDelete={vi.fn()} />);
  act(() => screen.getAllByTestId("element-shot-item")[1].focus());
  fireEvent.click(screen.getByTestId("annotation-remove"));
  expect(document.activeElement).toBe(screen.getAllByTestId("element-shot-item")[1]);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledWith("b");
  const second = screen.getAllByTestId("element-shot-item")[1];
  expect([...second.querySelectorAll("button")].map(button => button.dataset.testid))
    .toEqual(["annotation-remove", "annotation-edit", "download-media", "element-shot-delete"]);
});

it("keeps actions while focus stays inside and removes ghost tab stops after leaving", () => {
  render(<ElementShotMedia items={[{ id: "a", url: "a" }]} onEdit={vi.fn()} />);
  const card = screen.getByTestId("element-shot-item");
  expect(card.tabIndex).toBe(0);
  expect(screen.queryByRole("button")).toBeNull();
  act(() => card.focus());
  act(() => screen.getByTestId("annotation-edit").focus());
  fireEvent.pointerLeave(card);
  expect(screen.getByTestId("annotation-edit")).toBeTruthy();
  fireEvent.blur(card, { relatedTarget: document.body });
  expect(screen.queryByRole("button")).toBeNull();
});

it("persists resetting the second annotation and displays its raw bytes without changing other shots", async () => {
  const persisted: Record<string, EditorSnapshot> = {};
  const set = vi.fn(async (values: Record<string, EditorSnapshot>) => {
    Object.assign(persisted, structuredClone(values));
  });
  vi.stubGlobal("chrome", { storage: {
    session: { set, getBytesInUse: vi.fn().mockResolvedValue(0), QUOTA_BYTES: 10 * 1024 * 1024 },
    local: { get: vi.fn().mockResolvedValue({}) },
  } });
  const { useEditorStore } = await import("@/store/editor-store");
  const initial = useEditorStore.getState();
  const shots: ElementShot[] = ["a", "b", "c"].map((id, index) => ({
    id, selector: `#${id}`, tagName: "DIV", capturedAt: index + 1,
    viewport: { width: 100, height: 100 },
    raw: `data:image/webp;base64,${btoa(`raw-${id}`)}`,
    annotated: `data:image/webp;base64,${btoa(`annotated-${id}`)}`,
  }));
  let saving: Promise<boolean> | undefined;
  // Use the same image projection and real store callback as DraftingPanel.
  function StoreMedia() {
    const elementShots = useEditorStore(state => state.elementShots);
    const busy = useEditorStore(state => state.elementShotSaving);
    return <ElementShotMedia busy={busy}
      items={(elementShots ?? []).map(shot => ({ id: shot.id, url: elementShotImage(shot), annotated: !!shot.annotated }))}
      onReset={id => { saving = useEditorStore.getState().setElementShotAnnotation(id, null); }} />;
  }
  try {
    useEditorStore.setState({ phase: "drafting", captureMode: "screenshot", elementShots: shots,
      target: { tabId: 7, url: "https://example.com", title: "Example" },
      draft: { title: "Keep title", sections: { description: "Keep body" } } });
    render(<StoreMedia />);
    expect(screen.getAllByRole("img").map(img => img.getAttribute("src"))).toEqual(shots.map(shot => shot.annotated));
    act(() => screen.getAllByTestId("element-shot-item")[1].focus());
    await act(async () => {
      fireEvent.click(screen.getByTestId("annotation-remove"));
      expect(saving).toBeDefined();
      expect(await saving).toBe(true);
    });
    const expected = [shots[0], { ...shots[1], annotated: null }, shots[2]];
    expect(useEditorStore.getState().elementShots).toEqual(expected);
    expect(useEditorStore.getState().elementShotSaving).toBe(false);
    expect(screen.getAllByTestId("element-shot-item").map(card => card.dataset.shotId)).toEqual(["a", "b", "c"]);
    expect(screen.getAllByRole("img").map(img => img.getAttribute("src")))
      .toEqual([shots[0].annotated, shots[1].raw, shots[2].annotated]);
    expect(screen.queryByTestId("annotation-remove")).toBeNull();
    expect(document.activeElement).toBe(screen.getAllByTestId("element-shot-item")[1]);
    expect(set).toHaveBeenCalled();
    expect(persisted["editor:7"]).toMatchObject({ phase: "drafting", elementShots: expected,
      draft: { title: "Keep title", sections: { description: "Keep body" } } });
  } finally {
    cleanup();
    useEditorStore.setState(initial, true);
    vi.unstubAllGlobals();
  }
});
