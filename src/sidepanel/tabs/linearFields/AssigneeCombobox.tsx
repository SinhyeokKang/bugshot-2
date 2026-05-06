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
import type { LinearUser } from "@/types/linear";
import { sendBg } from "@/types/messages";

interface Props {
  teamId: string | undefined;
  value: string | undefined;
  valueName?: string;
  onChange: (assigneeId: string | undefined, assigneeName: string | undefined) => void;
}

export function AssigneeCombobox({ teamId, value, valueName, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LinearUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedTeamId, setLoadedTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !teamId) return;
    if (loadedTeamId === teamId && items.length > 0) return;
    setLoading(true);
    setError(null);
    sendBg<LinearUser[]>({ type: "linear.getMembers", teamId })
      .then((list) => {
        setItems(list);
        setLoadedTeamId(teamId);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [open, teamId]);

  const selected = items.find((u) => u.id === value);
  const label = selected?.name ?? (value ? valueName : undefined) ?? t("linear.field.assignee.select");
  const disabled = !teamId;

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
          <span className={cn("min-w-0 flex-1 truncate text-left", !selected && !value && "text-muted-foreground")}>
            {disabled ? t("linear.field.requireTeam") : label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("linear.field.assignee.search")} />
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
                <CommandEmpty>{t("linear.field.assignee.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((u) => {
                    const sel = value === u.id;
                    return (
                      <CommandItem
                        key={u.id}
                        value={u.name}
                        onSelect={() => {
                          onChange(sel ? undefined : u.id, sel ? undefined : u.name);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", sel ? "opacity-100" : "opacity-0")} />
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
