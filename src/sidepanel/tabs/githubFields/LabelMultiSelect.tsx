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
import type { GithubLabel } from "@/types/github";
import { sendBg } from "@/types/messages";
import { toggleLabel } from "./labelToggle";

interface Props {
  owner: string | undefined;
  repo: string | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}

export function LabelMultiSelect({ owner, repo, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GithubLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!owner && !!repo;

  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<GithubLabel[]>({
      type: "github.getLabels",
      owner: owner!,
      repo: repo!,
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
  }, [open, ready, owner, repo, items.length]);

  useEffect(() => {
    setItems([]);
  }, [owner, repo]);

  const triggerLabel = (() => {
    if (!ready) return t("github.field.requireRepo");
    if (value.length === 0) return t("github.field.labels.placeholder");
    if (value.length === 1) return value[0];
    return t("github.field.labels.summary", { name: value[0], n: value.length - 1 });
  })();

  return (
    <Popover open={open} onOpenChange={(v) => ready && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={!ready}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              value.length === 0 && "text-muted-foreground",
            )}
          >
            {triggerLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("github.field.labels.search")} />
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
                <CommandEmpty>{t("github.field.labels.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((l) => {
                    const isSelected = value.includes(l.name);
                    return (
                      <CommandItem
                        key={l.id}
                        value={l.name}
                        onSelect={() => onChange(toggleLabel(value, l.name))}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span
                          className="mr-2 inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                          style={{ backgroundColor: `#${l.color}` }}
                        />
                        <span className="truncate">{l.name}</span>
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
