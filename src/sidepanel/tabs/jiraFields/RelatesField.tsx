import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import type { JiraIssueSummary } from "@/types/jira";
import { sendBg } from "@/lib/bg-client";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useJiraConfig } from "./useJiraConfig";

interface RelatesValue {
  key: string;
  label: string;
}

export function RelatesField({
  value,
  projectKey,
  onChange,
}: {
  value: RelatesValue[];
  projectKey?: string;
  onChange: (next: RelatesValue[]) => void;
}) {
  const t = useT();
  // 조회 스코프는 prop, 이 훅은 null 여부만 본다 (EpicField의 주의사항과 동일).
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchIssues = useCallback(
    (query: string) => {
      if (!jira || !projectKey) return Promise.resolve([]);
      return sendBg<JiraIssueSummary[]>({
        type: "jira.searchEpics",
        projectKey,
        query: query || undefined,
      });
    },
    [jira, projectKey],
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
