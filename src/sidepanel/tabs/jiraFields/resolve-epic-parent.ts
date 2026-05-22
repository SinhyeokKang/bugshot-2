import type { EditorIssueFields } from "@/store/editor-store";

export function resolveEpicParentConflict(
  fields: EditorIssueFields,
  hierarchyLevel: number | undefined,
): Partial<EditorIssueFields> | null {
  if (hierarchyLevel == null || hierarchyLevel < 1) return null;
  if (!fields.parentKey) return null;

  const patch: Partial<EditorIssueFields> = {
    parentKey: undefined,
    parentLabel: undefined,
  };

  if (!fields.relatesKey) {
    patch.relatesKey = fields.parentKey;
    patch.relatesLabel = fields.parentLabel;
  }

  return patch;
}
