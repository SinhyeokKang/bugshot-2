import { describe, expect, it } from "vitest";
import { recordModeMeta } from "../recordModeMeta";

describe("recordModeMeta", () => {
  it("tab → appWindow 아이콘 + issue.mode.video 라벨", () => {
    expect(recordModeMeta("tab")).toEqual({
      icon: "appWindow",
      labelKey: "issue.mode.video",
    });
  });

  it("screen → monitorPlay 아이콘 + issue.mode.screenRecord 라벨", () => {
    expect(recordModeMeta("screen")).toEqual({
      icon: "monitorPlay",
      labelKey: "issue.mode.screenRecord",
    });
  });
});
