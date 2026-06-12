import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import type { EditorIssueFields } from "@/store/editor-store";
import { AssigneeField } from "./AssigneeField";
import { CcField } from "./CcField";
import { EpicField } from "./EpicField";
import { IssueTypeField } from "./IssueTypeField";
import { PriorityField } from "./PriorityField";
import { resolveEpicParentConflict } from "./resolve-epic-parent";

export function JiraIssueFields({
  fields,
  onChange,
}: {
  fields: EditorIssueFields;
  onChange: (patch: Partial<EditorIssueFields>) => void;
}) {
  const t = useT();
  const [isEpicType, setIsEpicType] = useState(false);

  const handleIssueTypeChange = useCallback(
    (id: string, hierarchyLevel?: number) => {
      const epic = hierarchyLevel != null && hierarchyLevel >= 1;
      setIsEpicType(epic);
      const patch: Partial<EditorIssueFields> = { issueTypeId: id };
      if (epic) {
        const conflict = resolveEpicParentConflict(fields, hierarchyLevel);
        if (conflict) Object.assign(patch, conflict);
      }
      onChange(patch);
    },
    [fields, onChange],
  );

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("create.issueType")} required>
        <IssueTypeField
          value={fields.issueTypeId}
          onChange={handleIssueTypeChange}
        />
      </FieldRow>
      <FieldRow label={t("create.assignee")}>
        <AssigneeField
          value={fields.assigneeId}
          fallbackLabel={fields.assigneeName}
          onChange={(id, name) => onChange({ assigneeId: id, assigneeName: name })}
        />
      </FieldRow>
      <FieldRow label={t("field.cc.label")}>
        <CcField value={fields.cc ?? []} onChange={(cc) => onChange({ cc })} />
      </FieldRow>
      <FieldRow label={t("create.priority")}>
        <PriorityField
          value={fields.priorityId}
          fallbackLabel={fields.priorityName}
          onChange={(id, name) => onChange({ priorityId: id, priorityName: name })}
        />
      </FieldRow>
      {!isEpicType && (
        <FieldRow label={t("create.parentEpic")}>
          <EpicField
            value={fields.parentKey}
            fallbackLabel={fields.parentLabel}
            onChange={(key, label) => onChange({ parentKey: key, parentLabel: label })}
            hierarchyLevels={[1]}
          />
        </FieldRow>
      )}
      <FieldRow label={t("create.linkedIssue")}>
        <EpicField
          value={fields.relatesKey}
          fallbackLabel={fields.relatesLabel}
          onChange={(key, label) => onChange({ relatesKey: key, relatesLabel: label })}
        />
      </FieldRow>
    </div>
  );
}
