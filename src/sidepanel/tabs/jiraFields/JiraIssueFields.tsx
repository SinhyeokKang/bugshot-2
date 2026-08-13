import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import type { EditorIssueFields } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import type { JiraSprint } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { AssigneeField } from "./AssigneeField";
import { CcField } from "./CcField";
import { EpicField } from "./EpicField";
import { IssueTypeField } from "./IssueTypeField";
import { PriorityField } from "./PriorityField";
import { ProjectField } from "./ProjectField";
import { RelatesField } from "./RelatesField";
import { SprintField } from "./SprintField";
import { resolveEpicParentConflict } from "./resolve-epic-parent";
import { resolveProjectChange } from "./project-change";
import { resolveStickySprint } from "./sprint-sticky";
import { useSprintFieldMeta } from "./useSprintFieldMeta";

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

  // 잠금 단서가 프로젝트 *변경* 시점에만 걸리면, 잠긴 채로 **열리는** 경로엔 아무 단서가 없다 —
  // 직전 제출이 계정 기본이 아닌 프로젝트였고 그 레코드에 이슈타입이 없으면(업데이트 이전 레코드가
  // 전부 그렇다) 다이얼로그가 열리자마자 제출 버튼이 잠긴다. 계정 기본 프로젝트는 제외한다 —
  // 거기선 IssueTypeField가 기본 이슈타입을 곧바로 채우므로 열어봐야 이미 고른 상태다.
  const entryCueDone = useRef(false);
  useEffect(() => {
    if (entryCueDone.current) return;
    if (!projectKey || fields.issueTypeId || projectKey === accountProjectKey) return;
    entryCueDone.current = true;
    setIssueTypeOpen(true);
  }, [projectKey, fields.issueTypeId, accountProjectKey]);

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

  // 스프린트는 사이트마다 id가 다른 커스텀 필드라 존재 여부를 서버에 묻는다. 칸반·보드 미연결·
  // team-managed·에픽 타입을 열거하지 않고 흡수하는 게 이 판정의 값이다.
  const {
    meta: sprintMeta,
    loading: sprintLoading,
    failed: sprintFailed,
    answered: sprintAnswered,
  } = useSprintFieldMeta(projectKey, fields.issueTypeId);
  // 재검증 래치는 boolean이 아니라 검증한 sprintId 값이다 — boolean이면 프로젝트를 바꿔 새
  // sticky 값이 들어와도 재검증이 안 돈다.
  const verifiedSprintRef = useRef<number | null>(null);
  const [sprintVerified, setSprintVerified] = useState(false);

  // 판정이 "없음"으로 **확정**됐을 때만 비운다. 판정 중의 임시 null도, 조회 실패(failed)도
  // 확정이 아니다 — 실패를 확정으로 읽으면 429 한 번에 사용자가 고른 스프린트가 사라진다.
  useEffect(() => {
    // 서버가 "없다"고 **답했을 때만** 비운다. 아직 안 물어봤거나(입력·인증 미비) 조회가
    // 실패한 건 확정이 아니다 — 확정으로 읽으면 429 한 번에, 혹은 이슈타입이 잠깐 빈 순간에
    // 사용자가 고른 스프린트가 지워지고 그 write가 세션 영속까지 나간다.
    if (!sprintAnswered || sprintFailed || sprintMeta || fields.sprintId == null) return;
    onChange({ sprintId: undefined, sprintName: undefined });
  }, [sprintAnswered, sprintFailed, sprintMeta, fields.sprintId, onChange]);

  // 검증은 meta가 확정된 뒤에만 돈다 — meta가 null이면 요청 0회라 위 비우기와 경합하지 않는다.
  useEffect(() => {
    const sprintId = fields.sprintId;
    if (!sprintMeta || sprintId == null) return;
    if (verifiedSprintRef.current === sprintId) return;
    verifiedSprintRef.current = sprintId;
    const name = fields.sprintName;
    sendBg<JiraSprint | null>({ type: "jira.getSprint", sprintId })
      .then((sprint) => {
        // 응답을 기다리는 사이 사용자가 다른 스프린트를 골랐으면 그 선택이 이긴다.
        if (verifiedSprintRef.current !== sprintId) return;
        const patch = resolveStickySprint({ sprintId, sprintName: name }, sprint);
        if (patch) onChange(patch);
        setSprintVerified(true);
      })
      .catch(() => {
        // 검증 불가는 "유효하지 않다"가 아니다. 값은 그대로 두고 이름도 보여준다 —
        // payload엔 실리는데 화면만 비면 고르지도 않은 스프린트로 제출한 꼴이 된다.
        // 래치는 닫아 둔다: 실패 원인이 429일 때 재시도를 여는 게 가장 해롭고, onChange가
        // 매 렌더 새 identity인 호출부가 있어 풀어두면 필드를 건드릴 때마다 다시 나간다.
        if (verifiedSprintRef.current !== sprintId) return;
        setSprintVerified(true);
      });
  }, [sprintMeta, fields.sprintId, fields.sprintName, onChange]);

  const handleSprintChange = useCallback(
    (id: number | undefined, name?: string) => {
      // 방금 목록에서 고른 값은 검증 대상이 아니다 — 래치를 미리 닫아 요청 한 번을 아낀다.
      verifiedSprintRef.current = id ?? null;
      setSprintVerified(true);
      onChange({ sprintId: id, sprintName: name });
    },
    [onChange],
  );

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
      {/* 판정 중에도 자리를 잡아두므로 아래 행들이 밀리지 않고, 판정이 돌긴 했는지가 눈에 보인다.
          (SprintField는 자기 open을 직접 쥔다 — meta가 바뀌려면 프로젝트·이슈타입 콤보를 열어야
          하고 그 사이 스프린트 팝오버는 이미 닫혀 있다.) */}
      {!projectKey ? null : sprintLoading ? (
        <FieldRow label={t("create.sprint")}>
          {/* 콤보와 같은 높이를 잡아야 판정이 끝날 때 아래 5개 행이 안 밀린다. */}
          <div className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("common.loading")}
          </div>
        </FieldRow>
      ) : sprintMeta || (sprintFailed && fields.sprintId != null) ? (
        // 판정이 실패해도 값이 남아 있으면 행을 그린다 — 안 그리면 사용자는 제출되는 스프린트를
        // 보지도 해제하지도 못한다. fieldId는 몰라도 되고, 제출 시 background가 재해석한다.
        <FieldRow label={t("create.sprint")}>
          <SprintField
            projectKey={projectKey}
            value={fields.sprintId}
            // 검증 전에는 이름을 숨긴다(무효 판정에서 "골라놨던 게 사라졌다"로 읽히므로).
            // 단 판정 자체가 실패한 경로는 검증이 아예 안 도므로 그 예외를 열어야 한다 —
            // 안 그러면 행만 뜨고 라벨이 비어 무엇이 실려 나가는지 여전히 안 보인다.
            fallbackLabel={
              sprintVerified || sprintFailed ? fields.sprintName : undefined
            }
            onChange={handleSprintChange}
          />
        </FieldRow>
      ) : null}
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
