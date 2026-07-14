import { useT } from "@/i18n";
import type { GitlabDefaults } from "@/types/gitlab";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { CcCombobox, type CcValue } from "./CcCombobox";
import { LabelCombobox } from "./LabelCombobox";
import { ProjectCombobox, type ProjectValue } from "./ProjectCombobox";
import { FieldRow } from "@/sidepanel/components/FieldRow";

export interface GitlabIssueFieldsValue {
  projectId?: number;
  projectPath?: string;
  label?: string;
  assigneeId?: number;
  assigneeName?: string;
  cc?: CcValue[];
}

export function initialGitlabFields(
  last: GitlabIssueFieldsValue | undefined,
  defaults: GitlabDefaults | undefined,
): GitlabIssueFieldsValue {
  const hasLastProject = !!last?.projectId;
  const src = hasLastProject ? last : defaults;
  // assignee는 project 하위 필드(그 프로젝트 멤버) — project가 갈리면 defaults.assignee는 무효.
  const sameProject = hasLastProject && last!.projectId === defaults?.projectId;
  const fb = sameProject ? defaults : undefined;
  return {
    projectId: src?.projectId,
    projectPath: src?.projectPath,
    label: src?.label,
    assigneeId: hasLastProject ? (last!.assigneeId ?? fb?.assigneeId) : defaults?.assigneeId,
    assigneeName: hasLastProject ? (last!.assigneeName ?? fb?.assigneeName) : defaults?.assigneeName,
    cc: hasLastProject ? last!.cc : undefined,
  };
}

interface Props {
  value: GitlabIssueFieldsValue;
  onChange: (patch: Partial<GitlabIssueFieldsValue>) => void;
}

export function GitlabIssueFields({ value, onChange }: Props) {
  const t = useT();
  const projectValue: ProjectValue | null =
    value.projectId && value.projectPath
      ? { projectId: value.projectId, projectPath: value.projectPath }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("gitlab.field.project")} required>
        <ProjectCombobox
          value={projectValue}
          onChange={(next) =>
            onChange(
              next
                ? {
                    projectId: next.projectId,
                    projectPath: next.projectPath,
                    label: undefined,
                    assigneeId: undefined,
                    assigneeName: undefined,
                    cc: undefined,
                  }
                : {
                    projectId: undefined,
                    projectPath: undefined,
                    label: undefined,
                    assigneeId: undefined,
                    assigneeName: undefined,
                    cc: undefined,
                  },
            )
          }
        />
      </FieldRow>
      <FieldRow label={t("gitlab.field.labels")}>
        <LabelCombobox
          projectId={value.projectId}
          value={value.label}
          onChange={(label) => onChange({ label })}
        />
      </FieldRow>
      <FieldRow label={t("gitlab.field.assignee")}>
        <AssigneeCombobox
          projectId={value.projectId}
          value={
            value.assigneeId
              ? { id: value.assigneeId, username: value.assigneeName ?? "" }
              : null
          }
          onChange={(next) =>
            onChange({
              assigneeId: next?.id,
              assigneeName: next?.username,
            })
          }
        />
      </FieldRow>
      <FieldRow label={t("field.cc.label")}>
        <CcCombobox
          projectId={value.projectId}
          value={value.cc ?? []}
          onChange={(cc) => onChange({ cc })}
        />
      </FieldRow>
    </div>
  );
}
