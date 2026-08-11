import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { AsanaWorkspace } from "@/types/asana";
import { sendBg } from "@/types/messages";

export interface WorkspaceValue {
  workspaceGid: string;
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
    () => sendBg<AsanaWorkspace[]>({ type: "asana.getWorkspaces" }),
    [],
  );

  return (
    <SingleLazyCombobox
      disabled={!!disabled}
      load={load}
      getKey={(w) => w.gid}
      getName={(w) => w.name}
      selectedKey={value?.workspaceGid ?? null}
      onSelect={(w) =>
        onChange(w ? { workspaceGid: w.gid, workspaceName: w.name } : null)
      }
      triggerLabel={value ? value.workspaceName : t("asana.field.workspace.select")}
      searchPlaceholder={t("asana.field.workspace.search")}
      emptyLabel={t("asana.field.workspace.empty")}
    />
  );
}
