import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import type { JiraIssueSummary } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useJiraConfig } from "./useJiraConfig";

interface RelatesValue {
  key: string;
  label: string;
}

export function RelatesField({
  value,
  onChange,
}: {
  value: RelatesValue[];
  onChange: (next: RelatesValue[]) => void;
}) {
  const t = useT();
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchIssues = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraIssueSummary[]>({
        type: "jira.searchEpics",
        projectKey: jira.projectKey,
        query: query || undefined,
      });
    },
    [jira],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchIssues);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  function toggle(option: CcUserOption) {
    onChange(
      value.some((v) => v.key === option.key)
        ? value.filter((v) => v.key !== option.key)
        : [...value, { key: option.key, label: option.label }],
    );
  }

  return (
    <CcMultiCombobox
      options={items.map((i) => ({
        key: i.key,
        label: `${i.key} ${i.fields.summary}`,
        avatarUrl: i.fields.issuetype?.iconUrl,
      }))}
      selected={value}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      onOpenChange={setOpen}
      onSearch={search}
      selectLabel={t("field.epic.select")}
      searchPlaceholder={t("field.epic.search")}
      emptyLabel={t("field.epic.empty")}
      testId="relates-combobox"
      avatarRounded={false}
      renderTriggerLabel={(sel) =>
        sel.length === 1 ? sel[0].label : sel.map((s) => s.key).join(", ")
      }
    />
  );
}
