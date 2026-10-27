export interface ElementShotMeta {
  id: string;
  selector: string;
  tagName: string;
  viewport: { width: number; height: number };
  capturedAt: number;
}

export interface ElementShot extends ElementShotMeta {
  raw: string | null;
  annotated: string | null;
}

export interface SavedElementShot extends ElementShotMeta {
  imageSlot: `shot-${string}-v-${string}` | "before";
  hasImage: boolean;
}

export interface ElementShotPick {
  requestId: string;
  kind: "initial" | "append";
}
