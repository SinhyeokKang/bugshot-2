import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmConnectForm } from "../LlmConnectForm";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { fetchModels, GEMINI_FREE_MODELS, GEMINI_MODELS, PROVIDER_PRESETS } from "@/sidepanel/lib/ai-provider";
import { fetchOpenRouterFreeVisionModels, OPENROUTER_BASE_URL } from "@/sidepanel/lib/free-llm";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("@/sidepanel/hooks/useAI", () => ({ useAI: () => ({ capabilities: { promptStyle: "compact" } }) }));
vi.mock("@/sidepanel/lib/ai-provider", async (original) => ({ ...await original<object>(), fetchModels: vi.fn() }));
vi.mock("@/sidepanel/lib/free-llm", async (original) => ({ ...await original<object>(), fetchOpenRouterFreeVisionModels: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } } });
  useSettingsUiStore.setState({ llm: null });
  vi.mocked(fetchOpenRouterFreeVisionModels).mockResolvedValue([{ id: "new:free" }]);
  vi.mocked(fetchModels).mockResolvedValue([{ id: "paid-model" }]);
});
afterEach(() => vi.unstubAllGlobals());

describe("LLM onboarding and free model selection", () => {
  it("places the outline free button before the primary API-key button", async () => {
    const user = userEvent.setup();
    render(<LlmConnectForm />);
    const free = screen.getByTestId("llm-connect-free");
    const byok = screen.getByTestId("llm-connect-byok");
    expect(free.compareDocumentPosition(byok) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(free.className).toContain("border-input");
    expect(byok.className).toContain("bg-primary");
    await user.click(free);
    expect(screen.getByRole("dialog", { name: "llm.free.dialog.title" })).toBeTruthy();
  });
  it("uses the free OpenRouter endpoint for initial load and refresh, preserving a missing saved model", async () => {
    useSettingsUiStore.setState({ llm: { baseUrl: OPENROUTER_BASE_URL, apiKey: "key", modelId: "saved:free", freeTier: true } });
    const user = userEvent.setup();
    render(<LlmConnectForm />);
    await waitFor(() => expect(fetchOpenRouterFreeVisionModels).toHaveBeenCalledTimes(1));
    vi.mocked(fetchOpenRouterFreeVisionModels).mockRejectedValue(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "llm.model.refresh" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "llm.model.refresh" }).getAttribute("aria-disabled")).toBe("false"));
    expect(fetchOpenRouterFreeVisionModels).toHaveBeenCalledTimes(2);
    expect(fetchModels).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox").textContent).toContain("saved:free");
  });
  it("loads BYOK models once and does not retry automatically after a failed refresh", async () => {
    useSettingsUiStore.setState({ llm: { baseUrl: PROVIDER_PRESETS.find((p) => p.id === "openai")!.baseUrl, apiKey: "key", modelId: "saved" } });
    const user = userEvent.setup();
    render(<LlmConnectForm />);
    const refresh = screen.getByRole("button", { name: "llm.model.refresh" });
    await waitFor(() => expect(refresh.getAttribute("aria-disabled")).toBe("false"));
    expect(fetchModels).toHaveBeenCalledTimes(1);
    vi.mocked(fetchModels).mockRejectedValue(new Error("offline"));
    await user.click(refresh);
    await waitFor(() => expect(refresh.getAttribute("aria-disabled")).toBe("false"));
    expect(fetchModels).toHaveBeenCalledTimes(2);
    expect(fetchOpenRouterFreeVisionModels).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox").textContent).toContain("saved");
  });
  it.each([false, true])("offers the correct Gemini list for freeTier=%s", async (freeTier) => {
    useSettingsUiStore.setState({ llm: { baseUrl: PROVIDER_PRESETS.find((p) => p.id === "gemini")!.baseUrl, apiKey: "key", modelId: "saved", ...(freeTier ? { freeTier: true as const } : {}) } });
    const user = userEvent.setup();
    render(<LlmConnectForm />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option").map((e) => e.textContent)).toEqual((freeTier ? GEMINI_FREE_MODELS : GEMINI_MODELS).map((m) => m.id));
  });
  it("preserves freeTier when selecting a different model", async () => {
    useSettingsUiStore.setState({ llm: { baseUrl: OPENROUTER_BASE_URL, apiKey: "key", modelId: "saved:free", freeTier: true } });
    const user = userEvent.setup();
    render(<LlmConnectForm />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "new:free" }));
    expect(useSettingsUiStore.getState().llm).toEqual({ baseUrl: OPENROUTER_BASE_URL, apiKey: "key", modelId: "new:free", freeTier: true });
  });
});
