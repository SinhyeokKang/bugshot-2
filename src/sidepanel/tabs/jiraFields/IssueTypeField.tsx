import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import type { JiraIssueType } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { FieldCombobox } from "./FieldCombobox";

export function IssueTypeField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraIssueType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectKey = jiraAccount?.projectKey;

  useEffect(() => {
    setItems([]);
    setError(null);
  }, [projectKey]);

  useEffect(() => {
    if (!open || !jiraAccount || !projectKey) return;
    if (items.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraIssueType[]>({
      type: "jira.listIssueTypes",
      projectKey,
    })
      .then((list) => !cancelled && setItems(list))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jiraAccount, projectKey, items.length]);

  const defaultId = jiraAccount?.issueTypeId;
  const defaultName = jiraAccount?.issueTypeName;
  const effectiveValue = value ?? defaultId;
  const selected = items.find((i) => i.id === effectiveValue);

  useEffect(() => {
    if (!value && defaultId) onChange(defaultId);
  }, [value, defaultId, onChange]);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.issueType.select")}
      searchPlaceholder={t("field.issueType.search")}
      emptyMessage={t("field.issueType.empty")}
      label={selected?.name ?? (effectiveValue ? defaultName : undefined)}
    >
      {items.map((it) => (
        <CommandItem
          key={it.id}
          value={it.name}
          onSelect={() => {
            onChange(it.id);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              effectiveValue === it.id ? "opacity-100" : "opacity-0",
            )}
          />
          {it.iconUrl ? (
            <img src={it.iconUrl} alt="" className="mr-2 h-4 w-4" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{it.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
