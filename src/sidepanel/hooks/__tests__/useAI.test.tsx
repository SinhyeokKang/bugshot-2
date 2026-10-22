import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { create } from "zustand";
import type { LocaleMode } from "@/i18n/locales";
import type { LlmConfig } from "@/store/settings-ui-store";

const settings = create<{ locale: LocaleMode; llm: LlmConfig | null }>(() => ({ locale: "en", llm: null }));
vi.mock("@/store/settings-ui-store", () => ({ useSettingsUiStore: (selector: (s: unknown) => unknown) => settings(selector) }));
vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({ toastLlmError: vi.fn() }));
import { useAI } from "../useAI";
import { useReproPrefill } from "../useReproPrefill";
import { setChromeAIContext } from "@/sidepanel/lib/chrome-ai";
import type { EditorDraft } from "@/store/editor-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  settings.setState({ locale: "en", llm: null });
  setChromeAIContext("ko", true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function nativeAPI() {
  const response = deferred<string>();
  const native = { prompt: vi.fn().mockReturnValue(response.promise), destroy: vi.fn() };
  const api = { availability: vi.fn().mockResolvedValue("available"), create: vi.fn().mockResolvedValue(native) };
  vi.stubGlobal("LanguageModel", api);
  return { api, native, response };
}
function reproHarness() {
  let cancel: (() => void) | null = null;
  const setLoading = vi.fn();
  const applied = vi.fn();
  const setAiCancel = (fn: (() => void) | null) => { cancel = fn; };
  const getAiCancel = () => cancel;
  const editor = create<{ done: boolean; draft: EditorDraft }>(() => ({ done: false, draft: { title: "", sections: {} } }));
  const setDone = (done: boolean) => editor.setState({ done });
  const setDraft = (draft: EditorDraft) => { applied(draft); editor.setState({ draft }); };
  const hook = renderHook(() => {
    const ai = useAI();
    const locale = settings((s) => s.locale);
    const done = editor((s) => s.done);
    const draft = editor((s) => s.draft);
    useReproPrefill({
      captureMode: "video", actionLog: { id: "a", startedAt: 0, endedAt: 1, totalSeen: 1, captured: 1, entries: [{ id: "1", kind: "click", timestamp: 1, pageUrl: "https://example.com", target: "Submit" }] },
      draft, setDraft, aiStatus: ai.status, capabilities: ai.capabilities, createSession: ai.createSession,
      locale, aiLanguage: "auto", url: "https://example.com", pageTitle: "Test", trimming: false, sectionEnabled: true,
      autoReproPrefill: true, reproPrefillDone: done, setReproPrefillDone: setDone, setLoading, setAiCancel, getAiCancel,
    });
    return { ai, draft, done };
  });
  return { ...hook, applied, setLoading, cancel: () => cancel?.() };
}

describe("shared Chrome useAI boundary", () => {
  it("shares preparation completion across subscribers without implicit downloads", async () => {
    const { api, native } = nativeAPI();
    api.availability.mockResolvedValue("downloadable");
    const download = deferred<typeof native>();
    api.create.mockReturnValue(download.promise);
    const { result } = renderHook(() => [useAI(), useAI()]);
    await waitFor(() => expect(result.current[0].chromeAI.availability).toBe("downloadable"));
    expect(api.create).not.toHaveBeenCalled();
    act(() => { void result.current[0].prepareChromeAI(); void result.current[1].prepareChromeAI(); });
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(result.current[1].chromeAI.availability).toBe("downloading");
    api.availability.mockResolvedValue("available");
    await act(async () => { download.resolve(native); });
    expect(result.current.map((ai) => ai.status)).toEqual(["available", "available"]);
    expect(native.destroy).toHaveBeenCalledTimes(1);
  });
  it("ignores stale locale and BYOK preparation results", async () => {
    const { api, native } = nativeAPI();
    const download = deferred<typeof native>();
    api.availability.mockResolvedValue("downloadable");
    api.create.mockReturnValue(download.promise);
    const { result } = renderHook(() => useAI());
    await waitFor(() => expect(result.current.chromeAI.availability).toBe("downloadable"));
    act(() => { void result.current.prepareChromeAI(); });
    act(() => { settings.setState({ locale: "ko", llm: { baseUrl: "https://api.openai.com/v1", modelId: "test", apiKey: "key" } }); });
    await act(async () => { download.resolve(native); });
    expect(result.current.status).toBe("available");
    expect(result.current.capabilities.promptStyle).toBe("rich");
    act(() => { settings.setState({ llm: null }); });
    expect(result.current.status).toBe("unavailable");
    expect(result.current.chromeAI.unsupportedLanguage).toBe(true);
    expect(native.destroy).toHaveBeenCalledTimes(1);
  });
  it("discards an old probe after language change", async () => {
    const { api } = nativeAPI();
    const old = deferred<string>();
    api.availability.mockReturnValueOnce(old.promise).mockResolvedValue("unavailable");
    const { result } = renderHook(() => useAI());
    act(() => { settings.setState({ locale: "ja" }); });
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    await act(async () => { old.resolve("available"); });
    expect(result.current.status).toBe("unavailable");
    expect(api.create).not.toHaveBeenCalled();
  });
});

describe("real useAI to repro native integration", () => {
  it("readopts one deferred inference after locale/checking/available transitions", async () => {
    const { api, native, response } = nativeAPI();
    const { result, applied, setLoading } = reproHarness();
    await waitFor(() => expect(native.prompt).toHaveBeenCalledTimes(1));
    const probe = deferred<string>();
    api.availability.mockReturnValueOnce(probe.promise);
    act(() => { settings.setState({ locale: "ja" }); });
    expect(result.current.ai.status).toBe("checking");
    await act(async () => { probe.resolve("available"); });
    await waitFor(() => expect(result.current.ai.status).toBe("available"));
    await act(async () => { response.resolve('{"stepsToReproduce":"Click Submit"}'); });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(result.current.draft.sections.stepsToReproduce).toBe("Click Submit");
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(native.destroy).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it("never applies an explicitly cancelled late native response", async () => {
    const { native, response } = nativeAPI();
    const { applied, setLoading, cancel } = reproHarness();
    await waitFor(() => expect(native.prompt).toHaveBeenCalledTimes(1));
    const signal = native.prompt.mock.calls[0][1].signal;
    act(() => { cancel(); });
    expect(signal.aborted).toBe(true);
    await act(async () => { response.resolve('{"stepsToReproduce":"Late"}'); });
    expect(applied).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(native.destroy).toHaveBeenCalledTimes(1);
  });
  it("does not start an automatic download after the cached available model is removed", async () => {
    const { api } = nativeAPI();
    api.availability.mockResolvedValueOnce("available").mockResolvedValue("downloadable");
    const { result, applied, setLoading } = reproHarness();
    await waitFor(() => expect(result.current.done).toBe(true));
    await waitFor(() => expect(result.current.ai.chromeAI.availability).toBe("downloadable"));
    expect(api.create).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });
});
