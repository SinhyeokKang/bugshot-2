import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { AsanaUser } from "@/types/asana";
import { sendBg } from "@/lib/bg-client";

export interface AssigneeValue {
  gid: string;
  name: string;
}

interface Props {
  workspaceGid: string | undefined;
  value: AssigneeValue | null;
  onChange: (next: AssigneeValue | null) => void;
}

export function AssigneeCombobox({ workspaceGid, value, onChange }: Props) {
  const t = useT();
  const ready = !!workspaceGid;
  // searchUsers는 서버 검색이 없어 워크스페이스 멤버를 1회 받아 클라이언트 필터.
  const load = useCallback(
    () =>
      sendBg<AsanaUser[]>({
        type: "asana.searchAssignees",
        workspaceGid: workspaceGid!,
        query: "",
      }),
    [workspaceGid],
  );

  const triggerLabel = (() => {
    if (!ready) return t("asana.field.requireWorkspace");
    if (!value) return t("asana.field.assignee.placeholder");
    return value.name;
  })();

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(u) => u.gid}
      getName={(u) => u.name}
      getItemValue={(u) => u.gid}
      pinSelected
      renderItem={(u) => (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{u.name}</span>
          {u.email ? (
            <span className="truncate text-xs text-muted-foreground">{u.email}</span>
          ) : null}
        </span>
      )}
      selectedKey={value?.gid ?? null}
      onSelect={(u) => onChange(u ? { gid: u.gid, name: u.name } : null)}
      triggerLabel={triggerLabel}
      searchPlaceholder={t("asana.field.assignee.search")}
      emptyLabel={t("asana.field.assignee.empty")}
    />
  );
}
