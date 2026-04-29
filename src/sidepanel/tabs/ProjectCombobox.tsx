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
import type { JiraProject } from "@/types/jira";
import { sendBg } from "@/types/messages";

export function ProjectCombobox() {
  const t = useT();
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const updateJiraConfig = useSettingsStore((s) => s.updateJiraConfig);

  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jiraConfig) return;
    if (projects.length > 0) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    sendBg<JiraProject[]>({ type: "jira.listProjects" })
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
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
  }, [open, jiraConfig, projects.length]);

  if (!jiraConfig) return null;

  const selected = projects.find((p) => p.key === jiraConfig.projectKey);
  const label = selected
    ? `${selected.name} (${selected.key})`
    : jiraConfig.projectKey
      ? jiraConfig.projectKey
      : t("project.select");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !jiraConfig.projectKey && "text-muted-foreground",
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
          <CommandInput placeholder={t("project.search")} />
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
                <CommandEmpty>{t("project.empty")}</CommandEmpty>
                <CommandGroup>
                  {projects.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={`${project.name} ${project.key}`}
                      onSelect={() => {
                        if (jiraConfig.projectKey !== project.key) {
                          updateJiraConfig({
                            projectKey: project.key,
                            issueTypeId: undefined,
                            issueTypeName: undefined,
                          });
                        }
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          jiraConfig.projectKey === project.key
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{project.name}</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {project.key}
                        </span>
                      </div>
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
