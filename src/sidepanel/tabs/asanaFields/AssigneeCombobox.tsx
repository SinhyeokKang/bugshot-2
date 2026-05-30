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
import type { AsanaUser } from "@/types/asana";
import { sendBg } from "@/types/messages";

export interface AssigneeValue {
  gid: string;
  name: string;
}

interface Props {
  workspaceGid: string | undefined;
  value: AssigneeValue | null;
  onChange: (next: AssigneeValue | null) => void;
}

export function AssigneeCombobox({ workspaceGid, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AsanaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!workspaceGid;

  useEffect(() => {
    if (!open || !ready) return;
    const myReq = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      sendBg<AsanaUser[]>({
        type: "asana.searchAssignees",
        workspaceGid: workspaceGid!,
        query,
      })
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
  }, [open, ready, workspaceGid, query]);

  // workspace 변경 시 후보 초기화 (종속 리셋).
  useEffect(() => {
    setItems([]);
  }, [workspaceGid]);

  const triggerLabel = (() => {
    if (!ready) return t("asana.field.requireWorkspace");
    if (!value) return t("asana.field.assignee.placeholder");
    return value.name;
  })();

  return (
    <Popover open={open} onOpenChange={(v) => ready && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={!ready}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
            {triggerLabel}
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
            placeholder={t("asana.field.assignee.search")}
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
                <CommandEmpty>{t("asana.field.assignee.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((u) => {
                    const selected = value?.gid === u.gid;
                    return (
                      <CommandItem
                        key={u.gid}
                        value={u.name}
                        onSelect={() => {
                          onChange(selected ? null : { gid: u.gid, name: u.name });
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{u.name}</span>
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
