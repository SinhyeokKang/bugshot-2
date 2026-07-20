import type { TranslationKey } from "@/i18n/ko";

export type AiLoadingSurface = "styling" | "draft" | "repro";

const PHRASES: Record<AiLoadingSurface, TranslationKey[]> = {
  styling: [
    "aiStyling.loading1",
    "aiStyling.loading2",
    "aiStyling.loading3",
    "aiStyling.loading4",
    "aiStyling.loading5",
  ],
  draft: [
    "aiDraft.loading1",
    "aiDraft.loading2",
    "aiDraft.loading3",
    "aiDraft.loading4",
    "aiDraft.loading5",
  ],
  repro: [
    "aiRepro.loading1",
    "aiRepro.loading2",
    "aiRepro.loading3",
    "aiRepro.loading4",
    "aiRepro.loading5",
  ],
};

export function aiLoadingSurface(flags: {
  styling: boolean;
  draft: boolean;
  repro: boolean;
}): AiLoadingSurface | null {
  if (flags.styling) return "styling";
  if (flags.draft) return "draft";
  if (flags.repro) return "repro";
  return null;
}

export function aiLoadingPhraseKey(
  surface: AiLoadingSurface,
  step: number,
): TranslationKey {
  const list = PHRASES[surface];
  const n = Math.max(Math.trunc(step), 0);
  return list[n % list.length];
}
