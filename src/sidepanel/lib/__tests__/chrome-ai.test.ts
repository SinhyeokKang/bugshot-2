import { afterEach, describe, expect, it, vi } from "vitest";
import { createChromeAIController, chromeAILanguageOptions } from "../chrome-ai";
import { createChromeAIProvider } from "../ai-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mockAPI() {
  const session = { prompt: vi.fn().mockResolvedValue("ok"), destroy: vi.fn() };
  const api = { availability: vi.fn().mockResolvedValue("downloadable"), create: vi.fn().mockResolvedValue(session) };
  vi.stubGlobal("LanguageModel", api);
  return { api, session };
}
afterEach(() => vi.unstubAllGlobals());

describe("Chrome readiness", () => {
  it("declares English system input and requested output without Korean fallback", () => {
    expect(chromeAILanguageOptions("ja")).toEqual({ expectedInputs: [{ type: "text", languages: ["en", "ja"] }], expectedOutputs: [{ type: "text", languages: ["ja"] }] });
    expect(chromeAILanguageOptions("ko")).toBeNull();
  });
  it.each(["available", "downloadable", "downloading", "unavailable"])("probes %s without creating a session", async (value) => {
    const { api } = mockAPI();
    api.availability.mockResolvedValue(value);
    const controller = createChromeAIController("en");
    await controller.refresh();
    expect(controller.getSnapshot().availability).toBe(value);
    expect(api.create).not.toHaveBeenCalled();
  });
  it("deduplicates probes and prepares synchronously before user activation is lost", async () => {
    const { api, session } = mockAPI();
    const probe = deferred<string>();
    api.availability.mockReturnValue(probe.promise);
    const controller = createChromeAIController("ja");
    const first = controller.refresh();
    expect(controller.refresh()).toBe(first);
    const ready = deferred<typeof session>();
    api.create.mockReturnValue(ready.promise);
    const preparing = controller.prepare();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(controller.prepare()).toBe(preparing);
    expect(controller.getSnapshot().progress).toBeNull();
    const monitor = api.create.mock.calls[0][0].monitor;
    let progress!: (event: { loaded: number }) => void;
    monitor({ addEventListener: (_type: string, fn: typeof progress) => { progress = fn; } });
    progress({ loaded: 0.4 });
    expect(controller.getSnapshot().progress).toBe(0.4);
    ready.resolve(session);
    await preparing;
    probe.resolve("downloadable");
    await first;
    expect(controller.getSnapshot().availability).toBe("available");
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(api.availability.mock.calls[0][0]).toEqual(chromeAILanguageOptions("ja"));
    expect(api.create.mock.calls[0][0]).toMatchObject(chromeAILanguageOptions("ja")!);
  });
  it("allows retry after failure and ignores invalidated completion while destroying its session", async () => {
    const { api, session } = mockAPI();
    const controller = createChromeAIController("en");
    api.create.mockRejectedValueOnce(new Error("download failed"));
    await controller.prepare();
    expect(controller.getSnapshot().error).toBe(true);
    const late = deferred<typeof session>();
    api.create.mockReturnValueOnce(late.promise);
    const preparing = controller.prepare();
    controller.invalidate();
    late.resolve(session);
    await preparing;
    expect(controller.getSnapshot().availability).toBe("checking");
    expect(session.destroy).toHaveBeenCalledTimes(1);
    await controller.prepare();
    expect(controller.getSnapshot().availability).toBe("available");
  });
  it("handles missing API and rejected probes without staying checking", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const controller = createChromeAIController("en");
    await controller.refresh();
    expect(controller.getSnapshot().availability).toBe("unavailable");
    const { api } = mockAPI();
    api.availability.mockRejectedValueOnce(new Error("failed"));
    await controller.refresh();
    expect(controller.getSnapshot().error).toBe(true);
    await controller.refresh();
    expect(controller.getSnapshot().availability).toBe("downloadable");
  });
  it("blocks unsupported language even when a browser claims availability", async () => {
    const { api } = mockAPI();
    api.availability.mockResolvedValue("available");
    const controller = createChromeAIController("ko");
    await controller.refresh();
    await controller.prepare();
    expect(controller.getSnapshot().unsupportedLanguage).toBe(true);
    await expect(createChromeAIProvider("ko").generate({ prompt: "한국어" })).rejects.toThrow();
    expect(api.availability).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
  it("rechecks availability before every ordinary create after a model was deleted", async () => {
    const { api, session } = mockAPI();
    api.availability.mockResolvedValueOnce("available").mockResolvedValue("downloadable");
    const provider = createChromeAIProvider("ja");
    await provider.generate({ prompt: "test" });
    expect(session.destroy).toHaveBeenCalledTimes(1);
    await expect(provider.createSession("system")).rejects.toThrow();
    await expect(provider.generate({ prompt: "test" })).rejects.toThrow();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.availability).toHaveBeenCalledTimes(3);
  });
});
