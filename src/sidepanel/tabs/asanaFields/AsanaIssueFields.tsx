import { useT } from "@/i18n";
import type { AsanaDefaults } from "@/types/asana";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { CcCombobox, type CcValue } from "./CcCombobox";
import { ProjectCombobox, type ProjectValue } from "./ProjectCombobox";
import { WorkspaceCombobox } from "./WorkspaceCombobox";
import { FieldRow } from "@/sidepanel/components/FieldRow";

export interface AsanaIssueFieldsValue {
  workspaceGid?: string;
  workspaceName?: string;
  projectGid?: string;
  projectName?: string;
  assigneeGid?: string;
  assigneeName?: string;
  cc?: CcValue[];
}

export function initialAsanaFields(
  last: AsanaIssueFieldsValue | undefined,
  defaults: AsanaDefaults | undefined,
): AsanaIssueFieldsValue {
  // workspace는 connect 기본값을 우선 사용.
  const workspaceGid = defaults?.workspaceGid ?? last?.workspaceGid;
  const workspaceName = defaults?.workspaceName ?? last?.workspaceName;
  // project·assignee는 같은 workspace일 때만 last로 prefill, 아니면 connect 기본값.
  // 해소된 workspace가 곧 defaults의 것이므로 defaults.assignee는 항상 유효하다(거친 스코프 예외).
  const sameWs = !!last?.workspaceGid && last.workspaceGid === workspaceGid;
  // id·표시명은 한 사람을 가리키는 쌍이라 소스를 통째로 고른다 — 따로 fallback하면 다른 사람 이름이 붙는다.
  const assigneeSrc = sameWs && last?.assigneeGid ? last : defaults;
  return {
    workspaceGid,
    workspaceName,
    projectGid: sameWs ? last?.projectGid : defaults?.projectGid,
    projectName: sameWs ? last?.projectName : defaults?.projectName,
    assigneeGid: assigneeSrc?.assigneeGid,
    assigneeName: assigneeSrc?.assigneeName,
    cc: sameWs ? last?.cc : undefined,
  };
}

interface Props {
  value: AsanaIssueFieldsValue;
  onChange: (patch: Partial<AsanaIssueFieldsValue>) => void;
}

export function AsanaIssueFields({ value, onChange }: Props) {
  const t = useT();

  const projectValue: ProjectValue | null =
    value.projectGid && value.projectName
      ? { projectGid: value.projectGid, projectName: value.projectName }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("asana.field.workspace")} required>
        <WorkspaceCombobox
          value={
            value.workspaceGid && value.workspaceName
              ? { workspaceGid: value.workspaceGid, workspaceName: value.workspaceName }
              : null
          }
          onChange={(next) =>
            onChange({
              workspaceGid: next?.workspaceGid,
              workspaceName: next?.workspaceName,
              // workspace 변경 시 하위 선택값 초기화.
              projectGid: undefined,
              projectName: undefined,
              assigneeGid: undefined,
              assigneeName: undefined,
              cc: undefined,
            })
          }
        />
      </FieldRow>

      <FieldRow label={t("asana.field.project")}>
        <ProjectCombobox
          workspaceGid={value.workspaceGid}
          value={projectValue}
          onChange={(next) =>
            onChange({
              projectGid: next?.projectGid,
              projectName: next?.projectName,
            })
          }
        />
      </FieldRow>

      <FieldRow label={t("asana.field.assignee")}>
        <AssigneeCombobox
          workspaceGid={value.workspaceGid}
          value={
            value.assigneeGid
              ? { gid: value.assigneeGid, name: value.assigneeName ?? "" }
              : null
          }
          onChange={(next) =>
            onChange({
              assigneeGid: next?.gid,
              assigneeName: next?.name,
            })
          }
        />
      </FieldRow>

      <FieldRow label={t("field.cc.label")}>
        <CcCombobox
          workspaceGid={value.workspaceGid}
          value={value.cc ?? []}
          onChange={(cc) => onChange({ cc })}
        />
      </FieldRow>
    </div>
  );
}
