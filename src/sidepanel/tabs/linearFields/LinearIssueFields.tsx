import { useT } from "@/i18n";
import type { LinearDefaults } from "@/types/linear";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { CcCombobox, type CcValue } from "./CcCombobox";
import { LabelCombobox } from "./LabelCombobox";
import { PrioritySelect } from "./PrioritySelect";
import { ProjectCombobox } from "./ProjectCombobox";
import { TeamCombobox, type TeamValue } from "./TeamCombobox";

export interface LinearIssueFieldsValue {
  teamId?: string;
  teamName?: string;
  teamKey?: string;
  projectId?: string;
  projectName?: string;
  labelId?: string;
  labelName?: string;
  assigneeId?: string;
  assigneeName?: string;
  priority?: number;
  cc?: CcValue[];
}

export function initialLinearFields(
  last: Partial<LinearIssueFieldsValue> | undefined,
  defaults: LinearDefaults | undefined,
): LinearIssueFieldsValue {
  if (!last?.teamId) {
    return {
      teamId: defaults?.teamId,
      teamName: defaults?.teamName,
      teamKey: defaults?.teamKey,
      projectId: defaults?.projectId,
      projectName: defaults?.projectName,
      labelId: defaults?.labelId,
      labelName: defaults?.labelName,
      assigneeId: defaults?.assigneeId,
      assigneeName: defaults?.assigneeName,
      priority: defaults?.priority,
      cc: undefined,
    };
  }
  // 같은 팀이면 defaults를 fallback으로 사용 (팀 스코프 필드이므로 다른 팀이면 무시)
  const fb = last.teamId === defaults?.teamId ? defaults : undefined;
  return {
    teamId: last.teamId,
    teamName: last.teamName ?? fb?.teamName,
    teamKey: last.teamKey ?? fb?.teamKey,
    projectId: last.projectId ?? fb?.projectId,
    projectName: last.projectName ?? fb?.projectName,
    labelId: last.labelId ?? fb?.labelId,
    labelName: last.labelName ?? fb?.labelName,
    assigneeId: last.assigneeId ?? fb?.assigneeId,
    assigneeName: last.assigneeName ?? fb?.assigneeName,
    priority: last.priority ?? fb?.priority,
    cc: last.cc,
  };
}

interface Props {
  value: LinearIssueFieldsValue;
  onChange: (patch: Partial<LinearIssueFieldsValue>) => void;
}

export function LinearIssueFields({ value, onChange }: Props) {
  const t = useT();

  const teamValue: TeamValue | null = value.teamId
    ? { teamId: value.teamId, teamName: value.teamName ?? "", teamKey: value.teamKey ?? "" }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("linear.field.team")} required>
        <TeamCombobox
          value={teamValue}
          onChange={(next) =>
            onChange(
              next
                ? {
                    teamId: next.teamId,
                    teamName: next.teamName,
                    teamKey: next.teamKey,
                    projectId: undefined,
                    projectName: undefined,
                    labelId: undefined,
                    labelName: undefined,
                    assigneeId: undefined,
                    assigneeName: undefined,
                    cc: undefined,
                  }
                : {
                    teamId: undefined,
                    teamName: undefined,
                    teamKey: undefined,
                    projectId: undefined,
                    projectName: undefined,
                    labelId: undefined,
                    labelName: undefined,
                    assigneeId: undefined,
                    assigneeName: undefined,
                    cc: undefined,
                  },
            )
          }
        />
      </FieldRow>
      <FieldRow label={t("linear.field.project")}>
        <ProjectCombobox
          teamId={value.teamId}
          value={value.projectId}
          valueName={value.projectName}
          onChange={(projectId, projectName) => onChange({ projectId, projectName })}
        />
      </FieldRow>
      <FieldRow label={t("linear.field.labels")}>
        <LabelCombobox
          teamId={value.teamId}
          value={value.labelId}
          valueName={value.labelName}
          onChange={(labelId, labelName) => onChange({ labelId, labelName })}
        />
      </FieldRow>
      <FieldRow label={t("linear.field.assignee")}>
        <AssigneeCombobox
          teamId={value.teamId}
          value={value.assigneeId}
          valueName={value.assigneeName}
          onChange={(assigneeId, assigneeName) => onChange({ assigneeId, assigneeName })}
        />
      </FieldRow>
      <FieldRow label={t("linear.field.priority")}>
        <PrioritySelect
          value={value.priority}
          onChange={(priority) => onChange({ priority })}
        />
      </FieldRow>
      <FieldRow label={t("field.cc.label")}>
        <CcCombobox
          teamId={value.teamId}
          value={value.cc ?? []}
          onChange={(cc) => onChange({ cc })}
        />
      </FieldRow>
    </div>
  );
}
