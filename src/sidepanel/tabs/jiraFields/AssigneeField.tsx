import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { orderSelectedFirst } from "@/sidepanel/components/ccOptions";
import type { JiraUser } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { FieldCombobox } from "./FieldCombobox";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useJiraConfig } from "./useJiraConfig";

export function AssigneeField({
  value,
  fallbackLabel,
  onChange,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (id: string | undefined, name?: string) => void;
}) {
  const t = useT();
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchUsers = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraUser[]>({
        type: "jira.searchUsers",
        query,
      });
    },
    [jira],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchUsers);
  const [resolved, setResolved] = useState<JiraUser | null>(null);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);
      search(q);
    },
    [search],
  );

  // 이미 담당자로 지정됐지만 검색 결과에 없는 유저를 id로 재조회해 아바타·이메일 보강.
  useEffect(() => {
    if (!open || !value || !jira) return;
    if (items.some((u) => u.accountId === value)) return;
    if (resolved?.accountId === value) return;
    let cancelled = false;
    sendBg<JiraUser[]>({ type: "jira.getUsers", accountIds: [value] })
      .then((users) => {
        if (!cancelled && users[0]) setResolved(users[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, items]);

  const merged =
    !searching &&
    resolved &&
    resolved.accountId === value &&
    !items.some((u) => u.accountId === resolved.accountId)
      ? [resolved, ...items]
      : items;
  const displayItems = searching
    ? items
    : orderSelectedFirst(merged, (u) => u.accountId === value);
  const selected =
    items.find((u) => u.accountId === value) ??
    (resolved?.accountId === value ? resolved : undefined);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.assignee.select")}
      searchPlaceholder={t("field.assignee.search")}
      emptyMessage={t("field.assignee.empty")}
      label={selected?.displayName}
      fallbackLabel={fallbackLabel}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      onSearch={handleSearch}
      groupLabel={t("field.assignee.label")}
    >
      {displayItems.map((u) => (
        <CommandItem
          key={u.accountId}
          value={u.accountId}
          onSelect={() => {
            onChange(u.accountId, u.displayName);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === u.accountId ? "opacity-100" : "opacity-0",
            )}
          />
          {u.avatarUrls?.["16x16"] ? (
            <img
              src={u.avatarUrls["16x16"]}
              alt=""
              className="mr-2 h-4 w-4 rounded-full"
            />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{u.displayName}</span>
            {u.emailAddress ? (
              <span className="truncate text-xs text-muted-foreground">
                {u.emailAddress}
              </span>
            ) : null}
          </span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
