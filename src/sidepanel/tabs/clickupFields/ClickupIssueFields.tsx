import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import type { ClickupDefaults } from "@/types/clickup";
import type { ClickupLastSubmitFields } from "@/types/platform";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { CcCombobox } from "./CcCombobox";
import { ListCombobox, type ListValue } from "./ListCombobox";
import { SpaceCombobox, type SpaceValue } from "./SpaceCombobox";
import { WorkspaceCombobox, type WorkspaceValue } from "./WorkspaceCombobox";

export interface ClickupIssueFieldsValue {
  workspaceId?: string;
  workspaceName?: string;
  spaceId?: string;
  spaceName?: string;
  listId?: string;
  listName?: string;
  assigneeId?: string;
  assigneeName?: string;
  cc?: { id: string; name: string }[];
}

// 3단계(Workspace→Space→List) prefill 우선순위:
// workspace는 connect defaults 우선. space/list/assignee/cc는 last가 같은 workspace일 때만 last.
export function initialClickupFields(
  last: ClickupLastSubmitFields | undefined,
  defaults: ClickupDefaults | undefined,
): ClickupIssueFieldsValue {
  const workspaceId = defaults?.workspaceId ?? last?.workspaceId;
  const workspaceName = defaults?.workspaceName ?? last?.workspaceName;
  const sameWs = !!last?.workspaceId && last.workspaceId === workspaceId;
  return {
    workspaceId,
    workspaceName,
    spaceId: sameWs ? last?.spaceId : defaults?.spaceId,
    spaceName: sameWs ? last?.spaceName : defaults?.spaceName,
    listId: sameWs ? last?.listId : defaults?.listId,
    listName: sameWs ? last?.listName : defaults?.listName,
    // 해소된 workspace가 곧 defaults의 것이므로 defaults.assignee는 항상 유효(거친 스코프 예외).
    assigneeId: sameWs ? (last?.assigneeId ?? defaults?.assigneeId) : defaults?.assigneeId,
    assigneeName: sameWs ? (last?.assigneeName ?? defaults?.assigneeName) : defaults?.assigneeName,
    cc: sameWs ? last?.cc : undefined,
  };
}

interface Props {
  value: ClickupIssueFieldsValue;
  onChange: (patch: Partial<ClickupIssueFieldsValue>) => void;
}

export function ClickupIssueFields({ value, onChange }: Props) {
  const t = useT();

  const workspaceValue: WorkspaceValue | null =
    value.workspaceId && value.workspaceName
      ? { workspaceId: value.workspaceId, workspaceName: value.workspaceName }
      : null;
  const spaceValue: SpaceValue | null =
    value.spaceId && value.spaceName
      ? { spaceId: value.spaceId, spaceName: value.spaceName }
      : null;
  const listValue: ListValue | null =
    value.listId && value.listName
      ? { listId: value.listId, listName: value.listName }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("clickup.field.workspace")} required>
        <WorkspaceCombobox
          value={workspaceValue}
          onChange={(next) =>
            onChange({
              workspaceId: next?.workspaceId,
              workspaceName: next?.workspaceName,
              // workspace 변경 시 하위 선택값 모두 초기화.
              spaceId: undefined,
              spaceName: undefined,
              listId: undefined,
              listName: undefined,
              assigneeId: undefined,
              assigneeName: undefined,
              cc: undefined,
            })
          }
        />
      </FieldRow>

      <FieldRow label={t("clickup.field.space")}>
        <SpaceCombobox
          workspaceId={value.workspaceId}
          value={spaceValue}
          onChange={(next) =>
            onChange({
              spaceId: next?.spaceId,
              spaceName: next?.spaceName,
              // space 변경 시 list만 초기화 (assignee/cc는 workspace 종속이라 유지).
              listId: undefined,
              listName: undefined,
            })
          }
        />
      </FieldRow>

      <FieldRow label={t("clickup.field.list")} required>
        <ListCombobox
          spaceId={value.spaceId}
          value={listValue}
          onChange={(next) =>
            onChange({ listId: next?.listId, listName: next?.listName })
          }
        />
      </FieldRow>

      <FieldRow label={t("clickup.field.assignee")}>
        <AssigneeCombobox
          workspaceId={value.workspaceId}
          value={
            value.assigneeId
              ? { id: value.assigneeId, name: value.assigneeName ?? "" }
              : null
          }
          onChange={(next) =>
            onChange({ assigneeId: next?.id, assigneeName: next?.name })
          }
        />
      </FieldRow>

      <FieldRow label={t("field.cc.label")}>
        <CcCombobox
          workspaceId={value.workspaceId}
          value={value.cc ?? []}
          onChange={(cc) => onChange({ cc })}
        />
      </FieldRow>
    </div>
  );
}
