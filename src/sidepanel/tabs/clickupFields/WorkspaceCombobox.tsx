import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { ClickupWorkspace } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface WorkspaceValue {
  workspaceId: string;
  workspaceName: string;
}

interface Props {
  value: WorkspaceValue | null;
  onChange: (next: WorkspaceValue | null) => void;
  disabled?: boolean;
}

export function WorkspaceCombobox({ value, onChange, disabled }: Props) {
  const t = useT();
  const load = useCallback(
    () => sendBg<ClickupWorkspace[]>({ type: "clickup.getTeams" }),
    [],
  );

  return (
    <SingleLazyCombobox
      disabled={!!disabled}
      load={load}
      getKey={(w) => w.id}
      getName={(w) => w.name}
      selectedKey={value?.workspaceId ?? null}
      onSelect={(w) =>
        onChange(w ? { workspaceId: w.id, workspaceName: w.name } : null)
      }
      triggerLabel={
        value ? value.workspaceName : t("clickup.field.workspace.select")
      }
      searchPlaceholder={t("clickup.field.workspace.search")}
      emptyLabel={t("clickup.field.workspace.empty")}
    />
  );
}
