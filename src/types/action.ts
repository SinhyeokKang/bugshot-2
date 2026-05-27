export type ActionEntryKind = "click" | "navigation" | "input";

export interface ActionEntry {
  id: string;
  kind: ActionEntryKind;
  timestamp: number;
  pageUrl: string;
  // click
  target?: string;
  selector?: string;
  // navigation
  navType?: "load" | "pushState" | "replaceState" | "popstate" | "hashchange";
  fromUrl?: string;
  toUrl?: string;
  // input
  fieldLabel?: string;
  value?: string;
  masked?: boolean;
}

export interface ActionLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  entries: ActionEntry[];
}

export type ActionLogSummary = string[];
