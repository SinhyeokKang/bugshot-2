import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import type { JiraIssueType } from "@/types/jira";
import { sendBg } from "@/types/messages";

export function IssueTypeCombobox() {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const updateJiraConfig = useSettingsStore((s) => s.updateJiraConfig);

  const [open, setOpen] = useState(false);
  const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectKey = jiraConfig?.projectKey;

  useEffect(() => {
    setIssueTypes([]);
    setError(null);
  }, [projectKey]);

  useEffect(() => {
    if (!open || !jiraConfig || !projectKey) return;
    if (issueTypes.length > 0) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    sendBg<JiraIssueType[]>({
      type: "jira.listIssueTypes",
      config: jiraConfig.auth,
      projectKey,
    })
      .then((list) => {
        if (cancelled) return;
        setIssueTypes(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, jiraConfig, projectKey, issueTypes.length]);

  if (!jiraConfig) return null;

  const disabled = !projectKey;
  const label = jiraConfig.issueTypeName
    ? jiraConfig.issueTypeName
    : disabled
      ? "프로젝트를 먼저 선택하세요"
      : "이슈 타입 선택";

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn(
              "truncate",
              !jiraConfig.issueTypeName && "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="이슈 타입 검색..." />
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
                <CommandEmpty>일치하는 이슈 타입이 없습니다.</CommandEmpty>
                <CommandGroup>
                  {issueTypes.map((it) => (
                    <CommandItem
                      key={it.id}
                      value={it.name}
                      onSelect={() => {
                        updateJiraConfig({
                          issueTypeId: it.id,
                          issueTypeName: it.name,
                        });
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          jiraConfig.issueTypeId === it.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      {it.iconUrl ? (
                        <img
                          src={it.iconUrl}
                          alt=""
                          className="mr-2 h-4 w-4"
                        />
                      ) : null}
                      <span className="truncate">{it.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
