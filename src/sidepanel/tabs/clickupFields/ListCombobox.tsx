import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { ClickupList } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface ListValue {
  listId: string;
  listName: string;
}

interface Props {
  spaceId: string | undefined;
  value: ListValue | null;
  onChange: (next: ListValue | null) => void;
}

export function ListCombobox({ spaceId, value, onChange }: Props) {
  const t = useT();
  const ready = !!spaceId;
  const load = useCallback(
    () => sendBg<ClickupList[]>({ type: "clickup.getLists", spaceId: spaceId! }),
    [spaceId],
  );

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(l) => l.id}
      getName={(l) => l.name}
      getItemValue={(l) => `${l.folderName ?? ""} ${l.name}`}
      renderItem={(l) => (
        <>
          <span className="min-w-0 flex-1 truncate">{l.name}</span>
          {l.folderName && (
            <span className="ml-2 max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
              {l.folderName}
            </span>
          )}
        </>
      )}
      selectedKey={value?.listId ?? null}
      onSelect={(l) =>
        onChange(l ? { listId: l.id, listName: l.name } : null)
      }
      triggerLabel={
        !ready
          ? t("clickup.field.requireSpace")
          : value
            ? value.listName
            : t("clickup.field.list.select")
      }
      searchPlaceholder={t("clickup.field.list.search")}
      emptyLabel={t("clickup.field.list.empty")}
    />
  );
}
