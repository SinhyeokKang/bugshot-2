import type { RecordingSource } from "@/store/editor-store";

export type RecordModeIcon = "appWindow" | "monitorPlay";

export interface RecordModeMeta {
  icon: RecordModeIcon;
  labelKey: "issue.mode.video" | "issue.mode.screenRecord";
}

export function recordModeMeta(mode: RecordingSource): RecordModeMeta {
  return mode === "screen"
    ? { icon: "monitorPlay", labelKey: "issue.mode.screenRecord" }
    : { icon: "appWindow", labelKey: "issue.mode.video" };
}
