import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
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
  const t = useT();
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
      ? t("issueType.selectProjectFirst")
      : t("field.issueType.select");

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
              "min-w-0 flex-1 truncate text-left",
              !jiraConfig.issueTypeName && "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("field.issueType.search")} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            ) : (
              <>
                <CommandEmpty>{t("field.issueType.empty")}</CommandEmpty>
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
                      <span className="min-w-0 flex-1 truncate">{it.name}</span>
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
