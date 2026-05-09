import { useCallback, useEffect, useRef, useState } from "react";

type ChromeAIStatus = "checking" | "available" | "unavailable";

export interface LanguageModelInstance {
  prompt(
    input: string,
    options?: { responseConstraint?: unknown },
  ): Promise<string>;
  destroy(): void;
}

declare global {
  interface LanguageModel {
    availability(options?: {
      expectedOutputLanguages?: string[];
    }): Promise<string>;
    create(options?: {
      systemPrompt?: string;
      expectedOutputLanguages?: string[];
      outputLanguages?: string[];
    }): Promise<LanguageModelInstance>;
  }
  // eslint-disable-next-line no-var
  var LanguageModel: LanguageModel | undefined;
}

export function useChromeAI() {
  const [status, setStatus] = useState<ChromeAIStatus>("checking");
  const sessionRef = useRef<LanguageModelInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!globalThis.LanguageModel) {
          setStatus("unavailable");
          return;
        }
        const availability = await globalThis.LanguageModel.availability({
          expectedOutputLanguages: ["en"],
        });
        if (!cancelled) {
          setStatus(
            availability === "available" || availability === "readily"
              ? "available"
              : "unavailable",
          );
        }
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
    };
  }, []);

  const generateDraft = useCallback(async (
    prompt: string,
    options?: { responseSchema?: unknown },
  ): Promise<string> => {
    if (!globalThis.LanguageModel) {
      throw new Error("Chrome AI unavailable");
    }
    if (!sessionRef.current) {
      sessionRef.current = await globalThis.LanguageModel.create({
        expectedOutputLanguages: ["en"],
        outputLanguages: ["en"],
      });
    }
    try {
      const promptOpts = options?.responseSchema
        ? { responseConstraint: options.responseSchema }
        : undefined;
      return await sessionRef.current.prompt(prompt, promptOpts);
    } catch (e) {
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
      throw e;
    }
  }, []);

  return { status, generateDraft };
}
