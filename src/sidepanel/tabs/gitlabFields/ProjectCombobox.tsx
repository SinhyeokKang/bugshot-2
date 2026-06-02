import { useEffect, useRef, useState } from "react";
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
import type { GitlabProject } from "@/types/gitlab";
import { sendBg } from "@/types/messages";

export interface ProjectValue {
  projectId: number;
  projectPath: string;
}

interface Props {
  value: ProjectValue | null;
  onChange: (next: ProjectValue | null) => void;
  disabled?: boolean;
}

export function ProjectCombobox({ value, onChange, disabled }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GitlabProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const myReq = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      sendBg<GitlabProject[]>({ type: "gitlab.searchProjects", query })
        .then((list) => {
          if (myReq !== reqIdRef.current) return;
          setItems(list);
        })
        .catch((err: unknown) => {
          if (myReq !== reqIdRef.current) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (myReq !== reqIdRef.current) return;
          setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const label = value ? value.projectPath : t("gitlab.field.project.select");

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("gitlab.field.project.search")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="px-3 py-6 text-center text-xs text-destructive">{error}</div>
            ) : (
              <>
                <CommandEmpty>{t("gitlab.field.project.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((p) => {
                    const selected = value?.projectId === p.id;
                    return (
                      <CommandItem
                        key={p.id}
                        value={p.pathWithNamespace}
                        onSelect={() => {
                          onChange(
                            selected
                              ? null
                              : { projectId: p.id, projectPath: p.pathWithNamespace },
                          );
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{p.nameWithNamespace}</span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {p.pathWithNamespace}
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
