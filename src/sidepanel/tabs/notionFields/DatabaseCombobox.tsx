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
import type { NotionDatabase } from "@/types/notion";
import { sendBg } from "@/types/messages";

interface Props {
  value: string | undefined;
  valueTitle: string | undefined;
  onChange: (id: string | undefined, title: string | undefined) => void;
  disabled?: boolean;
}

export function DatabaseCombobox({
  value,
  valueTitle,
  onChange,
  disabled,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<NotionDatabase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const myReq = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      sendBg<NotionDatabase[]>({ type: "notion.searchDatabases", query })
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
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const label = value
    ? valueTitle || t("notion.field.databaseUntitled")
    : t("notion.field.database.select");

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
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !value && "text-muted-foreground",
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
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("notion.field.database.search")}
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
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            ) : (
              <>
                <CommandEmpty>{t("notion.field.database.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((db) => {
                    const selected = value === db.id;
                    return (
                      <CommandItem
                        key={db.id}
                        value={db.id}
                        onSelect={() => {
                          onChange(
                            selected ? undefined : db.id,
                            selected ? undefined : db.title,
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
                        <span className="truncate">
                          {db.iconEmoji ? `${db.iconEmoji} ` : ""}
                          {db.title}
                        </span>
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
