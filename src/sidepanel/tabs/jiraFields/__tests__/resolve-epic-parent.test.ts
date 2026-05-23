import { describe, expect, it } from "vitest";
import type { EditorIssueFields } from "@/store/editor-store";
import { resolveEpicParentConflict } from "../resolve-epic-parent";

describe("resolveEpicParentConflict", () => {
  it("returns null when hierarchyLevel is undefined", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1", parentLabel: "PROJ-1 Epic" };
    expect(resolveEpicParentConflict(fields, undefined)).toBeNull();
  });

  it("returns null when hierarchyLevel < 1 (standard issue)", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1", parentLabel: "PROJ-1 Epic" };
    expect(resolveEpicParentConflict(fields, 0)).toBeNull();
  });

  it("returns null when hierarchyLevel >= 1 but no parentKey set", () => {
    const fields: EditorIssueFields = {};
    expect(resolveEpicParentConflict(fields, 1)).toBeNull();
  });

  it("moves parentKey to relatesKey when epic type and relatesKey empty", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1", parentLabel: "PROJ-1 Epic" };
    expect(resolveEpicParentConflict(fields, 1)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
      relatesKey: "PROJ-1",
      relatesLabel: "PROJ-1 Epic",
    });
  });

  it("clears parentKey without overwriting existing relatesKey", () => {
    const fields: EditorIssueFields = {
      parentKey: "PROJ-1",
      parentLabel: "PROJ-1 Epic",
      relatesKey: "PROJ-2",
      relatesLabel: "PROJ-2 Other",
    };
    expect(resolveEpicParentConflict(fields, 1)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
    });
  });

  it("handles hierarchyLevel > 1 (custom higher-level types)", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1", parentLabel: "PROJ-1 Epic" };
    const result = resolveEpicParentConflict(fields, 2);
    expect(result).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
      relatesKey: "PROJ-1",
      relatesLabel: "PROJ-1 Epic",
    });
  });
});
