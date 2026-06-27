import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { ClickupSpace } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface SpaceValue {
  spaceId: string;
  spaceName: string;
}

interface Props {
  workspaceId: string | undefined;
  value: SpaceValue | null;
  onChange: (next: SpaceValue | null) => void;
}

export function SpaceCombobox({ workspaceId, value, onChange }: Props) {
  const t = useT();
  const ready = !!workspaceId;
  const load = useCallback(
    () => sendBg<ClickupSpace[]>({ type: "clickup.getSpaces", teamId: workspaceId! }),
    [workspaceId],
  );

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(s) => s.id}
      getName={(s) => s.name}
      selectedKey={value?.spaceId ?? null}
      onSelect={(s) =>
        onChange(s ? { spaceId: s.id, spaceName: s.name } : null)
      }
      triggerLabel={
        !ready
          ? t("clickup.field.requireWorkspace")
          : value
            ? value.spaceName
            : t("clickup.field.space.select")
      }
      searchPlaceholder={t("clickup.field.space.search")}
      emptyLabel={t("clickup.field.space.empty")}
    />
  );
}
