import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { JiraIssueSummary } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { FieldCombobox } from "./FieldCombobox";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useJiraConfig } from "./useJiraConfig";

export function EpicField({
  value,
  fallbackLabel,
  onChange,
  hierarchyLevels,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (key: string | undefined, label?: string) => void;
  hierarchyLevels?: number[];
}) {
  const t = useT();
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchEpics = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraIssueSummary[]>({
        type: "jira.searchEpics",
        projectKey: jira.projectKey,
        query: query || undefined,
        hierarchyLevels,
      });
    },
    [jira, hierarchyLevels],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchEpics);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  const selected = items.find((i) => i.key === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.epic.select")}
      searchPlaceholder={t("field.epic.search")}
      emptyMessage={t("field.epic.empty")}
      label={selected ? `${selected.key} ${selected.fields.summary}` : undefined}
      fallbackLabel={fallbackLabel}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      onSearch={search}
      groupLabel={t("field.epic.label")}
    >
      {items.map((epic) => (
        <CommandItem
          key={epic.id}
          value={`${epic.key} ${epic.fields.summary}`}
          onSelect={() => {
            onChange(epic.key, `${epic.key} ${epic.fields.summary}`);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === epic.key ? "opacity-100" : "opacity-0",
            )}
          />
          {epic.fields.issuetype?.iconUrl ? (
            <img
              src={epic.fields.issuetype.iconUrl}
              alt=""
              title={epic.fields.issuetype.name}
              className="mr-1.5 h-4 w-4 shrink-0"
            />
          ) : null}
          <span className="shrink-0 text-muted-foreground">{epic.key}</span>
          <span className="ml-1.5 min-w-0 flex-1 truncate">{epic.fields.summary}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
