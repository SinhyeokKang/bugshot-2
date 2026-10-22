import type { LocaleMode } from "@/i18n/locales";
import type { LanguageModelLangOptions } from "./ai-provider";

export type ChromeAIAvailability = "checking" | "unavailable" | "downloadable" | "downloading" | "available";
export interface ChromeAIState {
  availability: ChromeAIAvailability;
  progress: number | null;
  error: boolean;
  unsupportedLanguage: boolean;
}

// Chrome Prompt API supported text languages (2026-08-26 documentation).
export function chromeAILanguageOptions(locale: LocaleMode): LanguageModelLangOptions | null {
  if (!["en", "ja", "es", "de", "fr"].includes(locale)) return null;
  return {
    expectedInputs: [{ type: "text", languages: locale === "en" ? ["en"] : ["en", locale] }],
    expectedOutputs: [{ type: "text", languages: [locale] }],
  };
}

function normalizeAvailability(value: string): ChromeAIAvailability {
  if (value === "readily") return "available";
  return value === "available" || value === "downloadable" || value === "downloading" ? value : "unavailable";
}

export function createChromeAIController(locale: LocaleMode) {
  const options = chromeAILanguageOptions(locale);
  const initial = (): ChromeAIState => ({ availability: options ? "checking" : "unavailable", progress: null, error: false, unsupportedLanguage: !options });
  let state = initial();
  let generation = 0;
  let probe: Promise<ChromeAIState> | null = null;
  let preparation: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: ChromeAIState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidate() {
      generation++;
      probe = null;
      publish(initial());
    },
    refresh(): Promise<ChromeAIState> {
      if (preparation) return preparation.then(() => controller.refresh());
      if (probe) return probe;
      if (!options || !globalThis.LanguageModel) {
        publish({ ...initial(), availability: "unavailable" });
        return Promise.resolve(state);
      }
      const epoch = ++generation;
      publish({ ...state, availability: "checking", error: false, progress: null });
      const api = globalThis.LanguageModel;
      probe = Promise.resolve().then(async () => {
        try {
          const availability = normalizeAvailability(await api.availability(options));
          if (epoch === generation) publish({ ...state, availability, error: false });
        } catch {
          if (epoch === generation) publish({ ...state, availability: "unavailable", error: true });
        } finally {
          if (epoch === generation) probe = null;
        }
        return state;
      });
      return probe;
    },
    prepare(): Promise<void> {
      if (preparation) return preparation;
      if (!options || !globalThis.LanguageModel) {
        publish({ ...initial(), availability: "unavailable" });
        return Promise.resolve();
      }
      const epoch = ++generation;
      probe = null;
      publish({ ...state, availability: "downloading", progress: null, error: false });
      // Call create before the first await: only this click path may download.
      try {
        const api = globalThis.LanguageModel;
        const pending = api.create({
          ...options,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              if (epoch !== generation || !Number.isFinite(event.loaded)) return;
              publish({ ...state, progress: Math.max(0, Math.min(1, event.loaded)) });
            });
          },
        });
        preparation = pending.then(async (session) => {
          session.destroy();
          if (epoch !== generation) return;
          const availability = normalizeAvailability(await api.availability(options));
          if (epoch === generation) publish({ ...state, availability, progress: null, error: false });
        }).catch(() => {
          if (epoch === generation) publish({ ...state, availability: "downloadable", progress: null, error: true });
        }).finally(() => {
          preparation = null;
        });
        return preparation;
      } catch {
        publish({ ...state, availability: "downloadable", progress: null, error: true });
        return Promise.resolve();
      }
    },
  };
  return controller;
}

const controllers = new Map<LocaleMode, ReturnType<typeof createChromeAIController>>();
let activeContext: string | null = null;
export function getChromeAIController(locale: LocaleMode) {
  let controller = controllers.get(locale);
  if (!controller) {
    controller = createChromeAIController(locale);
    controllers.set(locale, controller);
  }
  return controller;
}

export function setChromeAIContext(locale: LocaleMode, external: boolean) {
  const key = `${locale}:${external}`;
  if (key === activeContext) return;
  activeContext = key;
  controllers.forEach((controller) => controller.invalidate());
}

export async function requireChromeAIReady(locale: LocaleMode) {
  const controller = getChromeAIController(locale);
  const state = await controller.refresh();
  if (state !== controller.getSnapshot() || state.availability !== "available") throw new Error("Chrome AI unavailable: prepare it in AI settings or connect an external AI provider");
}
