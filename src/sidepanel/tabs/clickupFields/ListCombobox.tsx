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
import type { ClickupList } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface ListValue {
  listId: string;
  listName: string;
}

interface Props {
  spaceId: string | undefined;
  value: ListValue | null;
  onChange: (next: ListValue | null) => void;
}

export function ListCombobox({ spaceId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClickupList[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!spaceId;

  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<ClickupList[]>({ type: "clickup.getLists", spaceId: spaceId! })
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
  }, [open, ready, spaceId, items.length]);

  // space 변경 시 후보 초기화 (종속 리셋).
  useEffect(() => {
    setItems([]);
  }, [spaceId]);

  const triggerLabel = (() => {
    if (!ready) return t("clickup.field.requireSpace");
    if (!value) return t("clickup.field.list.select");
    return value.listName;
  })();

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((l) => l.name.toLowerCase().includes(q))
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
            placeholder={t("clickup.field.list.search")}
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
                <CommandEmpty>{t("clickup.field.list.empty")}</CommandEmpty>
                <CommandGroup>
                  {filtered.map((l) => {
                    const selected = value?.listId === l.id;
                    return (
                      <CommandItem
                        key={l.id}
                        value={`${l.folderName ?? ""} ${l.name}`}
                        onSelect={() => {
                          onChange(
                            selected ? null : { listId: l.id, listName: l.name },
                          );
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{l.name}</span>
                        {l.folderName && (
                          <span className="ml-2 max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                            {l.folderName}
                          </span>
                        )}
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
