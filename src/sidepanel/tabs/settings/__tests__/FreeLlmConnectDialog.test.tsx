import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { FreeLlmConnectDialog } from "../FreeLlmConnectDialog";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { connectProvider, GEMINI_FREE_MODELS, GEMINI_MODELS, PROVIDER_PRESETS } from "@/sidepanel/lib/ai-provider";
import { AI_STUDIO_KEY_URL, fetchOpenRouterFreeVisionModels, OPENROUTER_BASE_URL, probeOpenRouterModel } from "@/sidepanel/lib/free-llm";
import { launchOpenRouterAuth } from "@/sidepanel/openrouter-auth";
import { trackLlmConnect } from "@/sidepanel/lib/track-llm";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/sidepanel/lib/track-llm", () => ({ trackLlmConnect: vi.fn() }));
vi.mock("@/sidepanel/openrouter-auth", () => ({ launchOpenRouterAuth: vi.fn() }));
vi.mock("@/sidepanel/lib/ai-provider", async (original) => ({ ...await original<object>(), connectProvider: vi.fn() }));
vi.mock("@/sidepanel/lib/free-llm", async (original) => ({ ...await original<object>(), fetchOpenRouterFreeVisionModels: vi.fn(), probeOpenRouterModel: vi.fn() }));

const createWindow = vi.fn();
const geminiUrl = PROVIDER_PRESETS.find((p) => p.id === "gemini")!.baseUrl;
function Harness() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>reopen</button><FreeLlmConnectDialog open={open} onOpenChange={setOpen} /></>;
}
function setup() {
  render(<StrictMode><Harness /></StrictMode>);
  return userEvent.setup();
}
async function choose(user: ReturnType<typeof userEvent.setup>, id = "gemini") {
  await user.click(screen.getByTestId(`free-llm-card-${id}`));
  await user.click(screen.getByTestId("free-llm-next"));
}
async function geminiConnect(user: ReturnType<typeof userEvent.setup>) {
  await choose(user);
  await user.type(screen.getByTestId("free-llm-gemini-key"), "  key  ");
  await user.click(screen.getByRole("button", { name: "platform.connect" }));
}
async function pickModel(user: ReturnType<typeof userEvent.setup>, id = "vision:free") {
  const dialog = await screen.findByRole("dialog", { name: "llm.model.select" });
  await user.click(within(dialog).getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: id }));
  await user.click(within(dialog).getByRole("button", { name: "common.ok" }));
}
async function closeModel(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", { name: "llm.model.select" });
  await user.click(within(dialog).getByRole("button", { name: "common.close" }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  createWindow.mockResolvedValue({});
  vi.stubGlobal("chrome", { windows: { create: createWindow }, storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } } });
  useSettingsUiStore.setState({ llm: null });
  vi.mocked(connectProvider).mockResolvedValue({ models: GEMINI_MODELS, apiKey: "key" });
  vi.mocked(launchOpenRouterAuth).mockResolvedValue({ status: "ok", key: "issued-key" });
  vi.mocked(fetchOpenRouterFreeVisionModels).mockResolvedValue([{ id: "vision:free" }]);
  vi.mocked(probeOpenRouterModel).mockResolvedValue("ok");
});
afterEach(() => vi.unstubAllGlobals());

describe("free connection session", () => {
  it("requires a choice, renders disclosures, and cannot deselect a card", async () => {
    const user = setup();
    expect((screen.getByTestId("free-llm-next") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    for (const id of ["gemini", "openrouter"]) {
      const card = screen.getByTestId(`free-llm-card-${id}`);
      for (const field of ["model", "limit", "privacy"]) expect(within(card).getByText(`llm.free.${id}.${field}`)).toBeTruthy();
    }
    expect(screen.getByText("llm.free.openrouter.signupHint")).toBeTruthy();
    expect(screen.getByText("llm.free.openrouter.appNameNote")).toBeTruthy();
    const card = screen.getByTestId("free-llm-card-gemini");
    await user.click(card);
    await user.click(card);
    expect(card.getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("free-llm-next") as HTMLButtonElement).disabled).toBe(false);
  });
  it.each([false, true])("opens a Chrome-positioned popup and focuses the key even if popup rejection=%s", async (reject) => {
    if (reject) createWindow.mockRejectedValue(new Error("popup blocked"));
    const user = setup();
    await choose(user);
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(createWindow).toHaveBeenCalledWith({ url: AI_STUDIO_KEY_URL, type: "popup", width: 520, height: 760 });
    expect(document.activeElement).toBe(screen.getByTestId("free-llm-gemini-key"));
  });
  it("reopens the popup, resets input on back, and restores the chosen card focus", async () => {
    const user = setup();
    await choose(user);
    await user.click(screen.getByTestId("free-llm-reopen"));
    expect(createWindow).toHaveBeenCalledTimes(2);
    await user.type(screen.getByTestId("free-llm-gemini-key"), "   ");
    expect((screen.getByRole("button", { name: "platform.connect" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByTestId("free-llm-gemini-key"), "key");
    await user.click(screen.getByTestId("free-llm-back"));
    expect(document.activeElement).toBe(screen.getByTestId("free-llm-card-gemini"));
    await user.click(screen.getByTestId("free-llm-next"));
    expect((screen.getByTestId("free-llm-gemini-key") as HTMLInputElement).value).toBe("");
  });
  it("keeps a rejected Gemini key and step, then tracks failure on close", async () => {
    vi.mocked(connectProvider).mockRejectedValue(new Error("invalid key"));
    const user = setup();
    await geminiConnect(user);
    expect(toast.error).toHaveBeenCalledWith("llm.error.fetch");
    expect((screen.getByTestId("free-llm-gemini-key") as HTMLInputElement).value).toBe("  key  ");
    expect(trackLlmConnect).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(geminiUrl, "free", "failed");
  });
  it("offers only free Gemini models, retains the key on picker close, and stores success once", async () => {
    const user = setup();
    await geminiConnect(user);
    expect(connectProvider).toHaveBeenCalledWith(geminiUrl, "  key  ");
    let dialog = await screen.findByRole("dialog", { name: "llm.model.select" });
    await user.click(within(dialog).getByRole("combobox"));
    expect(screen.getAllByRole("option").map((e) => e.textContent)).toEqual(GEMINI_FREE_MODELS.map((m) => m.id));
    await user.keyboard("{Escape}");
    await closeModel(user);
    expect((screen.getByTestId("free-llm-gemini-key") as HTMLInputElement).value).toBe("  key  ");
    await user.click(screen.getByRole("button", { name: "platform.connect" }));
    await pickModel(user, GEMINI_FREE_MODELS[0].id);
    expect(useSettingsUiStore.getState().llm).toEqual({ baseUrl: geminiUrl, apiKey: "key", modelId: GEMINI_FREE_MODELS[0].id, freeTier: true });
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(geminiUrl, "free", "success");
  });
  it.each(["cancelled", "error", "empty", "models-error"])("handles OpenRouter %s without storing a connection", async (outcome) => {
    if (outcome === "cancelled") vi.mocked(launchOpenRouterAuth).mockResolvedValue({ status: "cancelled" });
    if (outcome === "error") vi.mocked(launchOpenRouterAuth).mockRejectedValue(new Error("offline"));
    if (outcome === "empty") vi.mocked(fetchOpenRouterFreeVisionModels).mockResolvedValue([]);
    if (outcome === "models-error") vi.mocked(fetchOpenRouterFreeVisionModels).mockRejectedValue(new Error("offline"));
    const user = setup();
    await choose(user, "openrouter");
    if (outcome === "cancelled") expect(toast.error).not.toHaveBeenCalled();
    else expect(toast.error).toHaveBeenCalledWith(outcome === "empty" ? "llm.free.error.noFreeVisionModel" : "llm.free.error.openrouter");
    expect(screen.getByTestId("free-llm-next")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "llm.model.select" })).toBeNull();
    expect(useSettingsUiStore.getState().llm).toBeNull();
    await user.keyboard("{Escape}");
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(OPENROUTER_BASE_URL, "free", outcome === "cancelled" ? "cancelled" : "failed");
  });
  it("reuses the issued key only until the outer dialog closes", async () => {
    const user = setup();
    await choose(user, "openrouter");
    await closeModel(user);
    await user.click(screen.getByTestId("free-llm-next"));
    await closeModel(user);
    expect(launchOpenRouterAuth).toHaveBeenCalledTimes(1);
    expect(fetchOpenRouterFreeVisionModels).toHaveBeenCalledTimes(2);
    expect(useSettingsUiStore.getState().llm).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("reopen"));
    expect((screen.getByTestId("free-llm-next") as HTMLButtonElement).disabled).toBe(true);
    await choose(user, "openrouter");
    expect(launchOpenRouterAuth).toHaveBeenCalledTimes(2);
  });
  it("blocks unavailable models, retains the picker, and accepts transient errors", async () => {
    vi.mocked(probeOpenRouterModel).mockResolvedValueOnce("unavailable").mockResolvedValueOnce("transient");
    const user = setup();
    await choose(user, "openrouter");
    await pickModel(user);
    expect(toast.error).toHaveBeenCalledWith("llm.free.error.modelUnavailable");
    expect(useSettingsUiStore.getState().llm).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "llm.model.select" });
    await user.click(within(dialog).getByRole("button", { name: "common.ok" }));
    expect(useSettingsUiStore.getState().llm).toEqual({ baseUrl: OPENROUTER_BASE_URL, apiKey: "issued-key", modelId: "vision:free", freeTier: true });
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(OPENROUTER_BASE_URL, "free", "success");
  });
  it("locks model selection and confirmation while the selected model probe is pending", async () => {
    const pending = deferred<"ok">();
    vi.mocked(fetchOpenRouterFreeVisionModels).mockResolvedValue([{ id: "vision:free" }, { id: "other:free" }]);
    vi.mocked(probeOpenRouterModel).mockReturnValue(pending.promise);
    const user = setup();
    await choose(user, "openrouter");
    await pickModel(user);
    const dialog = screen.getByRole("dialog", { name: "llm.model.select" });
    const model = within(dialog).getByRole("combobox") as HTMLButtonElement;
    const confirm = within(dialog).getByRole("button", { name: "common.ok" }) as HTMLButtonElement;
    expect(model.disabled || model.getAttribute("aria-disabled") === "true").toBe(true);
    expect(confirm.disabled || confirm.getAttribute("aria-disabled") === "true").toBe(true);
    await user.click(model);
    expect(screen.queryByRole("option", { name: "other:free" })).toBeNull();
    await user.click(confirm);
    expect(probeOpenRouterModel).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve("ok"));
    expect(useSettingsUiStore.getState().llm?.modelId).toBe("vision:free");
  });
  it("keeps a stable live region and does not announce authorization when reusing a key", async () => {
    const auth = deferred<Awaited<ReturnType<typeof launchOpenRouterAuth>>>();
    vi.mocked(launchOpenRouterAuth).mockReturnValueOnce(auth.promise);
    const user = setup();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    await choose(user, "openrouter");
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("llm.free.openrouter.waiting");
    await act(async () => auth.resolve({ status: "ok", key: "issued-key" }));
    await closeModel(user);
    const models = deferred<{ id: string }[]>();
    vi.mocked(fetchOpenRouterFreeVisionModels).mockReturnValueOnce(models.promise);
    await user.click(screen.getByTestId("free-llm-next"));
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("");
    expect(launchOpenRouterAuth).toHaveBeenCalledTimes(1);
    await act(async () => models.resolve([{ id: "vision:free" }]));
  });
  it("starts a fresh card selection and clears the key when reopened", async () => {
    const user = setup();
    await choose(user);
    await user.type(screen.getByTestId("free-llm-gemini-key"), "old-key");
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("reopen"));
    expect((screen.getByTestId("free-llm-next") as HTMLButtonElement).disabled).toBe(true);
    await choose(user);
    expect((screen.getByTestId("free-llm-gemini-key") as HTMLInputElement).value).toBe("");
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(geminiUrl, "free", "cancelled");
  });
  it("guards double clicks synchronously and shows the waiting status", async () => {
    const pending = deferred<Awaited<ReturnType<typeof launchOpenRouterAuth>>>();
    vi.mocked(launchOpenRouterAuth).mockReturnValue(pending.promise);
    const user = setup();
    await user.click(screen.getByTestId("free-llm-card-openrouter"));
    await user.dblClick(screen.getByTestId("free-llm-next"));
    expect(launchOpenRouterAuth).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("llm.free.openrouter.waiting");
    await act(async () => pending.resolve({ status: "cancelled" }));
  });
  it.each([false, true])("ignores late auth after close (reopen=%s)", async (reopen) => {
    const pending = deferred<Awaited<ReturnType<typeof launchOpenRouterAuth>>>();
    vi.mocked(launchOpenRouterAuth).mockReturnValue(pending.promise);
    const user = setup();
    await choose(user, "openrouter");
    await user.keyboard("{Escape}");
    if (reopen) await user.click(screen.getByText("reopen"));
    await act(async () => pending.resolve({ status: "ok", key: "old-key" }));
    expect(fetchOpenRouterFreeVisionModels).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "llm.model.select" })).toBeNull();
    expect(useSettingsUiStore.getState().llm).toBeNull();
    if (reopen) expect((screen.getByTestId("free-llm-next") as HTMLButtonElement).disabled).toBe(true);
  });
  it("ignores a probe completed after the model picker closes", async () => {
    const pending = deferred<"ok">();
    vi.mocked(probeOpenRouterModel).mockReturnValue(pending.promise);
    const user = setup();
    await choose(user, "openrouter");
    await pickModel(user);
    await closeModel(user);
    await act(async () => pending.resolve("ok"));
    expect(useSettingsUiStore.getState().llm).toBeNull();
  });
  it("blocks outside dismissal but permits Escape and tracks untouched cancellation once", async () => {
    const user = setup();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1)); });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith("", "free", "cancelled");
    await user.click(screen.getByText("reopen"));
    await user.keyboard("{Escape}");
    expect(trackLlmConnect).toHaveBeenCalledTimes(2);
  });
});
