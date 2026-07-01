import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { ClickupUser } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface AssigneeValue {
  id: string;
  name: string;
}

interface Props {
  workspaceId: string | undefined;
  value: AssigneeValue | null;
  onChange: (next: AssigneeValue | null) => void;
}

export function AssigneeCombobox({ workspaceId, value, onChange }: Props) {
  const t = useT();
  const ready = !!workspaceId;
  const load = useCallback(
    () => sendBg<ClickupUser[]>({ type: "clickup.getMembers", teamId: workspaceId! }),
    [workspaceId],
  );

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(u) => u.id}
      getName={(u) => u.name}
      getItemValue={(u) => u.id}
      pinSelected
      renderItem={(u) => (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{u.name}</span>
          {u.email ? (
            <span className="truncate text-xs text-muted-foreground">
              {u.email}
            </span>
          ) : null}
        </span>
      )}
      selectedKey={value?.id ?? null}
      onSelect={(u) => onChange(u ? { id: u.id, name: u.name } : null)}
      triggerLabel={
        !ready
          ? t("clickup.field.requireWorkspace")
          : value
            ? value.name
            : t("clickup.field.assignee.placeholder")
      }
      searchPlaceholder={t("clickup.field.assignee.search")}
      emptyLabel={t("clickup.field.assignee.empty")}
    />
  );
}
