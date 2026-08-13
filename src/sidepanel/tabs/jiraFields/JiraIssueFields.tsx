import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import type { EditorIssueFields } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import { AssigneeField } from "./AssigneeField";
import { CcField } from "./CcField";
import { EpicField } from "./EpicField";
import { IssueTypeField } from "./IssueTypeField";
import { PriorityField } from "./PriorityField";
import { ProjectField } from "./ProjectField";
import { RelatesField } from "./RelatesField";
import { resolveEpicParentConflict } from "./resolve-epic-parent";
import { resolveProjectChange } from "./project-change";

export function JiraIssueFields({
  fields,
  onChange,
}: {
  fields: EditorIssueFields;
  onChange: (patch: Partial<EditorIssueFields>) => void;
}) {
  const t = useT();
  const accountProjectKey = useSettingsStore((s) => s.accounts.jira?.projectKey);
  const [isEpicType, setIsEpicType] = useState(false);
  const [issueTypeOpen, setIssueTypeOpen] = useState(false);
  const projectKey = fields.projectKey ?? accountProjectKey;

  // 제출 게이트가 fields.projectKey를 요구하므로 표시값과 저장값이 갈리면 안 된다 —
  // 업데이트 이전에 만들어진 세션은 projectKey 없이 하이드레이트되고, 그러면 화면엔 계정 기본
  // 프로젝트가 보이는데 제출 버튼만 잠긴다. IssueTypeField의 기본 이슈타입 주입과 같은 위상.
  useEffect(() => {
    if (!fields.projectKey && accountProjectKey) onChange({ projectKey: accountProjectKey });
  }, [fields.projectKey, accountProjectKey, onChange]);

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

  // 프로젝트를 바꾸면 이슈타입이 비어 제출 버튼이 즉시 잠긴다. 그 유일한 단서가 이슈타입 콤보를
  // 대신 열어주는 것인데, 프로젝트 팝오버가 닫히며 트리거로 포커스를 되돌리는 순간 갓 열린 레이어가
  // dismiss된다 — 그래서 여는 시점을 onCloseAutoFocus로 미루고 포커스 복원 자체를 막는다.
  const pendingIssueTypeOpen = useRef(false);
  const handleProjectClosed = useCallback((event: Event) => {
    if (!pendingIssueTypeOpen.current) return;
    pendingIssueTypeOpen.current = false;
    event.preventDefault();
    setIssueTypeOpen(true);
  }, []);

  const handleProjectChange = useCallback(
    (next: string) => {
      // 비교 대상은 표시값이다. fields.projectKey는 백필 effect 전 undefined일 수 있고, 그 상태로
      // 화면에 보이는 계정 기본 프로젝트를 그대로 다시 고르면 전환으로 오판해 입력이 날아간다.
      const changed = next !== projectKey;
      onChange(resolveProjectChange({ projectKey }, next));
      if (!changed) return;
      // isEpicType은 handleIssueTypeChange 안에서만 갱신되는 로컬 상태라 patch로는 안 풀린다 —
      // 에픽 프로젝트에서 일반 프로젝트로 옮길 때 상위 에픽 행이 숨은 채 남는다.
      setIsEpicType(false);
      pendingIssueTypeOpen.current = true;
    },
    [projectKey, onChange],
  );

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("jira.project")} required>
        <ProjectField
          value={projectKey}
          fallbackLabel={projectKey}
          onChange={handleProjectChange}
          onCloseAutoFocus={handleProjectClosed}
        />
      </FieldRow>
      <FieldRow label={t("create.issueType")} required>
        <IssueTypeField
          value={fields.issueTypeId}
          projectKey={projectKey}
          open={issueTypeOpen}
          onOpenChange={setIssueTypeOpen}
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
      <FieldRow label={t("create.priority")}>
        <PriorityField
          value={fields.priorityId}
          fallbackLabel={fields.priorityName}
          onChange={(id, name) => onChange({ priorityId: id, priorityName: name })}
        />
      </FieldRow>
      {!isEpicType && (
        <FieldRow label={t("create.parentEpic")}>
          {/* key remount로 목록을 비운다 — useDebouncedSearch가 items reset을 노출하지 않아
              그대로 두면 다음 fetch가 올 때까지 이전 프로젝트의 에픽이 남는다. */}
          <EpicField
            key={projectKey}
            value={fields.parentKey}
            projectKey={projectKey}
            fallbackLabel={fields.parentLabel}
            onChange={(key, label) => onChange({ parentKey: key, parentLabel: label })}
            hierarchyLevels={[1]}
          />
        </FieldRow>
      )}
      <FieldRow label={t("create.linkedIssue")}>
        <RelatesField
          key={projectKey}
          value={fields.relates ?? []}
          projectKey={projectKey}
          onChange={(relates) => onChange({ relates })}
        />
      </FieldRow>
      <FieldRow label={t("field.cc.label")}>
        <CcField value={fields.cc ?? []} onChange={(cc) => onChange({ cc })} />
      </FieldRow>
    </div>
  );
}
