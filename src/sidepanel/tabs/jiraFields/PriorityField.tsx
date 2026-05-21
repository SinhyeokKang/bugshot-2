import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import type { JiraPriority } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { FieldCombobox } from "./FieldCombobox";

export function PriorityField({
  value,
  fallbackLabel,
  onChange,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (id: string | undefined, name?: string) => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraPriority[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jiraAccount) return;
    if (items.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraPriority[]>({ type: "jira.listPriorities" })
      .then((list) => !cancelled && setItems(list))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jiraAccount, items.length]);

  const selected = items.find((i) => i.id === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.priority.select")}
      searchPlaceholder={t("field.priority.search")}
      emptyMessage={t("field.priority.empty")}
      label={selected?.name}
      fallbackLabel={fallbackLabel}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      groupLabel={t("field.priority.label")}
    >
      {items.map((p) => (
        <CommandItem
          key={p.id}
          value={p.name}
          onSelect={() => {
            onChange(p.id, p.name);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === p.id ? "opacity-100" : "opacity-0",
            )}
          />
          {p.iconUrl ? (
            <img src={p.iconUrl} alt="" className="mr-2 h-4 w-4" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
