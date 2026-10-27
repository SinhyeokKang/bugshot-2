import type { ElementShot, ElementShotMeta, SavedElementShot } from "@/types/element-shot";

export interface LegacyOrCurrentShotInput {
  elementShots?: readonly ElementShot[] | null;
  shotSelector?: { selector: string; tagName: string } | null;
  screenshotRaw?: string | null;
  screenshotAnnotated?: string | null;
  screenshotViewport?: { width: number; height: number } | null;
  screenshotCapturedAt?: number | null;
}

export function resolveElementShots(input: LegacyOrCurrentShotInput): ElementShot[] {
  if (input.elementShots) return [...input.elementShots];
  if (!input.shotSelector) return [];
  return [{
    id: "legacy",
    ...input.shotSelector,
    raw: input.screenshotRaw ?? null,
    annotated: input.screenshotAnnotated ?? null,
    viewport: input.screenshotViewport ?? { width: 0, height: 0 },
    capturedAt: input.screenshotCapturedAt ?? 0,
  }];
}

export function elementShotImage(shot: Pick<ElementShot, "raw" | "annotated">): string | null {
  return shot.annotated ?? shot.raw;
}

export function joinElementShotSelectors(shots: readonly ElementShotMeta[]): string {
  return shots.map(s => s.selector).join(", ");
}

export function elementShotManifest(shots: readonly SavedElementShot[]) {
  return shots.map((shot, index) => ({
    id: `capture:shot-${shot.id}`,
    shotId: shot.id,
    imageSlot: shot.imageSlot,
    filename: `screenshot-${index + 1}.webp`,
    hasImage: shot.hasImage,
  }));
}
