import { useCallback, useEffect, useState } from "react";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import type { JiraUser } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useJiraConfig } from "./useJiraConfig";

interface CcValue {
  accountId: string;
  displayName: string;
}

interface Props {
  value: CcValue[];
  onChange: (next: CcValue[]) => void;
}

export function CcField({ value, onChange }: Props) {
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchUsers = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraUser[]>({ type: "jira.searchUsers", query });
    },
    [jira],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchUsers);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  function toggle(option: CcUserOption) {
    onChange(
      value.some((v) => v.accountId === option.key)
        ? value.filter((v) => v.accountId !== option.key)
        : [...value, { accountId: option.key, displayName: option.label }],
    );
  }

  return (
    <CcMultiCombobox
      options={items.map((u) => ({
        key: u.accountId,
        label: u.displayName,
        email: u.emailAddress,
        avatarUrl: u.avatarUrls?.["16x16"],
      }))}
      selected={value.map((v) => ({ key: v.accountId, label: v.displayName }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      onOpenChange={setOpen}
      onSearch={search}
    />
  );
}
