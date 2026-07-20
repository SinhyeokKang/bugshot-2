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

  const current = fields.relates ?? [];
  if (!current.some((r) => r.key === fields.parentKey)) {
    patch.relates = [
      ...current,
      { key: fields.parentKey, label: fields.parentLabel ?? fields.parentKey },
    ];
  }

  return patch;
}
