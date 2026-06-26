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
import type { ClickupWorkspace } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface WorkspaceValue {
  workspaceId: string;
  workspaceName: string;
}

interface Props {
  value: WorkspaceValue | null;
  onChange: (next: WorkspaceValue | null) => void;
  disabled?: boolean;
}

export function WorkspaceCombobox({ value, onChange, disabled }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClickupWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<ClickupWorkspace[]>({ type: "clickup.getTeams" })
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
  }, [open, items.length]);

  const label = value ? value.workspaceName : t("clickup.field.workspace.select");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((w) => w.name.toLowerCase().includes(q))
    : items;

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
            placeholder={t("clickup.field.workspace.search")}
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
                <CommandEmpty>{t("clickup.field.workspace.empty")}</CommandEmpty>
                <CommandGroup>
                  {filtered.map((w) => {
                    const selected = value?.workspaceId === w.id;
                    return (
                      <CommandItem
                        key={w.id}
                        value={w.name}
                        onSelect={() => {
                          onChange(
                            selected
                              ? null
                              : { workspaceId: w.id, workspaceName: w.name },
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
                        <span className="truncate">{w.name}</span>
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
