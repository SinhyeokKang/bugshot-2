import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor-store";
import {
  useSettingsStore,
  isJiraConfigComplete,
} from "@/store/settings-store";
import type {
  JiraConfigPayload,
  JiraIssueSummary,
  JiraIssueType,
  JiraPriority,
  JiraUser,
} from "@/types/jira";
import { sendBg } from "@/types/messages";

export function IssueCreateModal() {
  const [open, setOpen] = useState(false);
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const configured = isJiraConfigComplete(jiraConfig);

  const issueFields = useEditorStore((s) => s.issueFields);
  const setIssueFields = useEditorStore((s) => s.setIssueFields);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="xl"
          className="flex-1"
          disabled={!configured}
          title={configured ? undefined : "설정 탭에서 Jira를 먼저 연결하세요"}
        >
          <Send />
          이슈 생성
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">이슈 생성</DialogTitle>
        </DialogHeader>
        {configured ? (
          <div className="flex flex-col gap-4">
            <FieldRow label="이슈 타입">
              <IssueTypeField
                value={issueFields.issueTypeId}
                onChange={(id) => setIssueFields({ issueTypeId: id })}
              />
            </FieldRow>

            <FieldRow label="담당자">
              <AssigneeField
                value={issueFields.assigneeId}
                onChange={(id) => setIssueFields({ assigneeId: id })}
              />
            </FieldRow>

            <FieldRow label="우선순위">
              <PriorityField
                value={issueFields.priorityId}
                onChange={(id) => setIssueFields({ priorityId: id })}
              />
            </FieldRow>

            <FieldRow label="부모 에픽">
              <EpicField
                value={issueFields.parentKey}
                onChange={(key) => setIssueFields({ parentKey: key })}
              />
            </FieldRow>

            <FieldRow label="연결 에픽">
              <EpicField
                value={issueFields.relatesKey}
                onChange={(key) => setIssueFields({ relatesKey: key })}
              />
            </FieldRow>

            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
              >
                닫기
              </Button>
              <Button
                disabled
                title="제출 기능은 준비 중입니다"
              >
                <Send />
                이슈 생성
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function useJiraConfig(): { config: JiraConfigPayload; projectKey: string } | null {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  if (!jiraConfig?.projectKey) return null;
  return {
    config: {
      baseUrl: jiraConfig.baseUrl,
      email: jiraConfig.email,
      apiToken: jiraConfig.apiToken,
    },
    projectKey: jiraConfig.projectKey,
  };
}

function useDebouncedSearch<T>(
  fetchFn: (query: string) => Promise<T[]>,
  delay = 300,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const search = useCallback(
    (query: string) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      const timer = window.setTimeout(() => {
        fetchFn(query)
          .then((list) => {
            if (seq === seqRef.current) setItems(list);
          })
          .catch((err: unknown) => {
            if (seq === seqRef.current)
              setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (seq === seqRef.current) setLoading(false);
          });
      }, delay);
      return () => window.clearTimeout(timer);
    },
    [fetchFn, delay],
  );

  return { items, loading, error, search };
}

function IssueTypeField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraIssueType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectKey = jiraConfig?.projectKey;

  useEffect(() => {
    setItems([]);
    setError(null);
  }, [projectKey]);

  useEffect(() => {
    if (!open || !jiraConfig || !projectKey) return;
    if (items.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraIssueType[]>({
      type: "jira.listIssueTypes",
      config: {
        baseUrl: jiraConfig.baseUrl,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      },
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
  }, [open, jiraConfig, projectKey, items.length]);

  const defaultId = jiraConfig?.issueTypeId;
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
      placeholder="이슈 타입 선택"
      searchPlaceholder="이슈 타입 검색..."
      emptyMessage="일치하는 이슈 타입이 없습니다."
      label={selected?.name}
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
          <span className="truncate">{it.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

function PriorityField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraPriority[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jiraConfig) return;
    if (items.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraPriority[]>({
      type: "jira.listPriorities",
      config: {
        baseUrl: jiraConfig.baseUrl,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      },
    })
      .then((list) => !cancelled && setItems(list))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jiraConfig, items.length]);

  const selected = items.find((i) => i.id === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder="우선순위 선택"
      searchPlaceholder="우선순위 검색..."
      emptyMessage="일치하는 우선순위가 없습니다."
      label={selected?.name}
    >
      {items.map((p) => (
        <CommandItem
          key={p.id}
          value={p.name}
          onSelect={() => {
            onChange(p.id);
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
          <span className="truncate">{p.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

function AssigneeField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchUsers = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraUser[]>({
        type: "jira.searchUsers",
        config: jira.config,
        query,
      });
    },
    [jira],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchUsers);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  const selected = items.find((u) => u.accountId === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder="담당자 선택"
      searchPlaceholder="이름으로 검색..."
      emptyMessage="일치하는 사용자가 없습니다."
      label={selected?.displayName}
      onSearch={search}
    >
      {items.map((u) => (
        <CommandItem
          key={u.accountId}
          value={u.displayName}
          onSelect={() => {
            onChange(u.accountId);
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
          <span className="truncate">{u.displayName}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

function EpicField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (key: string | undefined) => void;
}) {
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);

  const fetchEpics = useCallback(
    (query: string) => {
      if (!jira) return Promise.resolve([]);
      return sendBg<JiraIssueSummary[]>({
        type: "jira.searchEpics",
        config: jira.config,
        projectKey: jira.projectKey,
        query: query || undefined,
      });
    },
    [jira],
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
      placeholder="에픽 선택 (선택사항)"
      searchPlaceholder="에픽 검색..."
      emptyMessage="일치하는 에픽이 없습니다."
      label={selected ? `${selected.key} ${selected.fields.summary}` : undefined}
      clearable={!!value}
      onClear={() => onChange(undefined)}
      onSearch={search}
    >
      {items.map((epic) => (
        <CommandItem
          key={epic.id}
          value={`${epic.key} ${epic.fields.summary}`}
          onSelect={() => {
            onChange(epic.key);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              value === epic.key ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="shrink-0 text-muted-foreground">{epic.key}</span>
          <span className="ml-1.5 truncate">{epic.fields.summary}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}

function FieldCombobox({
  open,
  onOpenChange,
  loading,
  error,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  label,
  clearable,
  onClear,
  onSearch,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  label?: string;
  clearable?: boolean;
  onClear?: () => void;
  onSearch?: (query: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn("truncate", !label && "text-muted-foreground")}
          >
            {label || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={!onSearch}>
          <CommandInput
            placeholder={searchPlaceholder}
            onValueChange={onSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                불러오는 중...
              </div>
            ) : error ? (
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup>{children}</CommandGroup>
                {clearable && onClear ? (
                  <CommandGroup>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => {
                        onClear();
                        onOpenChange(false);
                      }}
                    >
                      <span className="text-xs text-muted-foreground">
                        선택 해제
                      </span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
