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
import type { ClickupUser } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface AssigneeValue {
  id: string;
  name: string;
}

interface Props {
  workspaceId: string | undefined;
  value: AssigneeValue | null;
  onChange: (next: AssigneeValue | null) => void;
}

export function AssigneeCombobox({ workspaceId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClickupUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!workspaceId;

  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<ClickupUser[]>({ type: "clickup.getMembers", teamId: workspaceId! })
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
  }, [open, ready, workspaceId, items.length]);

  // workspace 변경 시 후보 초기화 (종속 리셋).
  useEffect(() => {
    setItems([]);
  }, [workspaceId]);

  const triggerLabel = (() => {
    if (!ready) return t("clickup.field.requireWorkspace");
    if (!value) return t("clickup.field.assignee.placeholder");
    return value.name;
  })();

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((u) => u.name.toLowerCase().includes(q))
    : items;

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
            placeholder={t("clickup.field.assignee.search")}
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
                <CommandEmpty>{t("clickup.field.assignee.empty")}</CommandEmpty>
                <CommandGroup>
                  {filtered.map((u) => {
                    const selected = value?.id === u.id;
                    return (
                      <CommandItem
                        key={u.id}
                        value={u.name}
                        onSelect={() => {
                          onChange(selected ? null : { id: u.id, name: u.name });
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
