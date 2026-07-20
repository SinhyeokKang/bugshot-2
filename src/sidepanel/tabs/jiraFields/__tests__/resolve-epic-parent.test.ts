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

  it("appends parentKey to relates[] when epic type and relates empty", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1", parentLabel: "PROJ-1 Epic" };
    expect(resolveEpicParentConflict(fields, 1)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
      relates: [{ key: "PROJ-1", label: "PROJ-1 Epic" }],
    });
  });

  it("appends parentKey to existing relates[] without dropping current entries", () => {
    const fields: EditorIssueFields = {
      parentKey: "PROJ-1",
      parentLabel: "PROJ-1 Epic",
      relates: [{ key: "PROJ-2", label: "PROJ-2 Other" }],
    };
    expect(resolveEpicParentConflict(fields, 1)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
      relates: [
        { key: "PROJ-2", label: "PROJ-2 Other" },
        { key: "PROJ-1", label: "PROJ-1 Epic" },
      ],
    });
  });

  it("does not duplicate when parentKey already present in relates[]", () => {
    const fields: EditorIssueFields = {
      parentKey: "PROJ-1",
      parentLabel: "PROJ-1 Epic",
      relates: [{ key: "PROJ-1", label: "PROJ-1 Epic" }],
    };
    expect(resolveEpicParentConflict(fields, 1)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
    });
  });

  it("falls back to key as label when parentLabel is missing", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1" };
    expect(resolveEpicParentConflict(fields, 1)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
      relates: [{ key: "PROJ-1", label: "PROJ-1" }],
    });
  });

  it("handles hierarchyLevel > 1 (custom higher-level types)", () => {
    const fields: EditorIssueFields = { parentKey: "PROJ-1", parentLabel: "PROJ-1 Epic" };
    expect(resolveEpicParentConflict(fields, 2)).toEqual({
      parentKey: undefined,
      parentLabel: undefined,
      relates: [{ key: "PROJ-1", label: "PROJ-1 Epic" }],
    });
  });
});
