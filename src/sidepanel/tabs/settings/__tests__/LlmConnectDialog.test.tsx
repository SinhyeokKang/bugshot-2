import { StrictMode, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmConnectDialog, LlmModelDialog } from "@/sidepanel/tabs/settings/LlmConnectDialog";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { trackLlmConnect } from "@/sidepanel/lib/track-llm";
import { toast } from "sonner";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/sidepanel/lib/track-llm", () => ({ trackLlmConnect: vi.fn() }));

const baseUrl = "https://api.openai.com/v1";
const fetchMock = vi.fn();
function Harness() {
  const [open, setOpen] = useState(true);
  const llm = useSettingsUiStore((s) => s.llm);
  if (llm) return <p>connected</p>;
  return <><button onClick={() => setOpen(true)}>reopen</button><LlmConnectDialog open={open} onOpenChange={setOpen} /></>;
}
async function startConnection() {
  const user = userEvent.setup();
  render(<StrictMode><Harness /></StrictMode>);
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: "OpenAI" }));
  await user.type(screen.getByPlaceholderText("llm.apiKeyPlaceholder"), "  key  ");
  await user.click(screen.getByRole("button", { name: "platform.connect" }));
  return user;
}
async function selectModel(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", { name: "llm.model.select" });
  await user.click(within(dialog).getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: "test-model" }));
  await user.click(within(dialog).getByRole("button", { name: "common.ok" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ data: [{ id: "test-model" }] })));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("chrome", {
    permissions: { request: vi.fn().mockResolvedValue(true) },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  });
  useSettingsUiStore.setState({ llm: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("BYOK connection session", () => {
  it("stores the validated trimmed key without freeTier and tracks success once on close", async () => {
    const user = await startConnection();
    expect(trackLlmConnect).not.toHaveBeenCalled();
    await selectModel(user);
    expect(useSettingsUiStore.getState().llm).toEqual({ baseUrl, apiKey: "key", modelId: "test-model" });
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(baseUrl, "byok", "success");
  });
  it("uses the redirect toast and tracks failed only when closed", async () => {
    fetchMock.mockResolvedValue({ type: "opaqueredirect", status: 0 });
    const user = await startConnection();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("llm.error.redirect"));
    expect(trackLlmConnect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "common.close" }));
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(baseUrl, "byok", "failed");
  });
  it("tracks an untouched close as cancelled, once per open", async () => {
    const user = userEvent.setup();
    render(<StrictMode><Harness /></StrictMode>);
    expect(trackLlmConnect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "common.close" }));
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith("", "byok", "cancelled");
    await user.click(screen.getByText("reopen"));
    await user.keyboard("{Escape}");
    expect(trackLlmConnect).toHaveBeenCalledTimes(2);
  });
  it("does not count closing the model picker as closing the connection session", async () => {
    const user = await startConnection();
    const dialog = await screen.findByRole("dialog", { name: "llm.model.select" });
    await user.click(within(dialog).getByRole("button", { name: "common.close" }));
    expect(trackLlmConnect).not.toHaveBeenCalled();
    expect(useSettingsUiStore.getState().llm).toBeNull();
    await user.click(screen.getByRole("button", { name: "common.close" }));
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(baseUrl, "byok", "cancelled");
  });
  it("success takes precedence over an earlier error in the same session", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const user = await startConnection();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "platform.connect" }));
    await selectModel(user);
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(baseUrl, "byok", "success");
  });
  it("ignores an old request after close and reopen", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
    const user = await startConnection();
    await user.click(screen.getByRole("button", { name: "common.close" }));
    await user.click(screen.getByText("reopen"));
    await act(async () => resolve(new Response(JSON.stringify({ data: [{ id: "old-model" }] }))));
    expect(screen.queryByRole("dialog", { name: "llm.model.select" })).toBeNull();
    expect(useSettingsUiStore.getState().llm).toBeNull();
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "platform.connect" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("preserves the selected provider and key when cancelled and reopened", async () => {
    const user = userEvent.setup();
    render(<StrictMode><Harness /></StrictMode>);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "OpenAI" }));
    await user.type(screen.getByPlaceholderText("llm.apiKeyPlaceholder"), "  retained-key  ");
    await user.click(screen.getByRole("button", { name: "common.close" }));
    await user.click(screen.getByText("reopen"));
    expect(screen.getByRole("combobox").textContent).toContain("OpenAI");
    expect((screen.getByPlaceholderText("llm.apiKeyPlaceholder") as HTMLInputElement).value).toBe("  retained-key  ");
  });
  it("tracks the saved provider when the selection changes during connection", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
    const user = await startConnection();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Gemini/ }));
    expect(screen.getByRole("combobox").textContent).toContain("Gemini");
    await act(async () => resolve(new Response(JSON.stringify({ data: [{ id: "test-model" }] }))));
    await selectModel(user);
    expect(useSettingsUiStore.getState().llm).toEqual({ baseUrl, apiKey: "key", modelId: "test-model" });
    expect(trackLlmConnect).toHaveBeenCalledTimes(1);
    expect(trackLlmConnect).toHaveBeenCalledWith(useSettingsUiStore.getState().llm!.baseUrl, "byok", "success");
  });
});

 it("keeps the model picker interactive when busy is omitted", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<LlmModelDialog pending={{ baseUrl, models: [{ id: "test-model" }] }} onSelect={onSelect} onClose={vi.fn()} />);
  const combo = screen.getByRole("combobox") as HTMLButtonElement;
  expect(combo.disabled).toBe(false);
  expect(combo.getAttribute("aria-disabled")).not.toBe("true");
  await user.click(combo);
  await user.click(screen.getByRole("option", { name: "test-model" }));
  const confirm = screen.getByRole("button", { name: "common.ok" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(false);
  expect(confirm.getAttribute("aria-disabled")).not.toBe("true");
  await user.click(confirm);
  expect(onSelect).toHaveBeenCalledWith("test-model");
});
