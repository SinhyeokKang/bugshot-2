import { useState } from "react";
import { useT } from "@/i18n";
import { AssigneeCombobox } from "./AssigneeCombobox";
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
}

export function initialAsanaFields(
  last: AsanaIssueFieldsValue | undefined,
  defaults:
    | { workspaceGid?: string; workspaceName?: string; projectGid?: string; projectName?: string }
    | undefined,
): AsanaIssueFieldsValue {
  // workspace는 connect 기본값을 우선 사용.
  const workspaceGid = defaults?.workspaceGid ?? last?.workspaceGid;
  const workspaceName = defaults?.workspaceName ?? last?.workspaceName;
  // project·assignee는 같은 workspace일 때만 last로 prefill, 아니면 connect 기본 project.
  const sameWs = !!last?.workspaceGid && last.workspaceGid === workspaceGid;
  return {
    workspaceGid,
    workspaceName,
    projectGid: sameWs ? last?.projectGid : defaults?.projectGid,
    projectName: sameWs ? last?.projectName : defaults?.projectName,
    assigneeGid: sameWs ? last?.assigneeGid : undefined,
    assigneeName: sameWs ? last?.assigneeName : undefined,
  };
}

interface Props {
  value: AsanaIssueFieldsValue;
  onChange: (patch: Partial<AsanaIssueFieldsValue>) => void;
}

export function AsanaIssueFields({ value, onChange }: Props) {
  const t = useT();
  const [changingWorkspace, setChangingWorkspace] = useState(false);

  const projectValue: ProjectValue | null =
    value.projectGid && value.projectName
      ? { projectGid: value.projectGid, projectName: value.projectName }
      : null;

  const showWorkspacePicker = changingWorkspace || !value.workspaceGid;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            {t("asana.field.workspace")}
            <span className="ml-0.5 text-destructive">*</span>
          </label>
          {value.workspaceGid && !changingWorkspace ? (
            <button
              type="button"
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setChangingWorkspace(true)}
            >
              {t("asana.field.workspace.change")}
            </button>
          ) : null}
        </div>
        {showWorkspacePicker ? (
          <WorkspaceCombobox
            value={
              value.workspaceGid && value.workspaceName
                ? { workspaceGid: value.workspaceGid, workspaceName: value.workspaceName }
                : null
            }
            onChange={(next) => {
              setChangingWorkspace(false);
              onChange({
                workspaceGid: next?.workspaceGid,
                workspaceName: next?.workspaceName,
                // workspace 변경 시 하위 선택값 초기화.
                projectGid: undefined,
                projectName: undefined,
                assigneeGid: undefined,
                assigneeName: undefined,
              });
            }}
          />
        ) : (
          <div className="flex h-9 items-center text-sm text-foreground">
            {value.workspaceName}
          </div>
        )}
      </div>

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
    </div>
  );
}
