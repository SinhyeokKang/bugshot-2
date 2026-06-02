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
import type { LinearTeam } from "@/types/linear";
import { sendBg } from "@/types/messages";

export interface TeamValue {
  teamId: string;
  teamName: string;
  teamKey: string;
}

interface Props {
  value: TeamValue | null;
  onChange: (next: TeamValue | null) => void;
}

export function TeamCombobox({ value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LinearTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || items.length > 0) return;
    setLoading(true);
    sendBg<LinearTeam[]>({ type: "linear.getTeams" })
      .then(setItems)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [open]);

  const label = value
    ? `${value.teamKey} — ${value.teamName}`
    : t("linear.field.team.select");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
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
        <Command>
          <CommandInput placeholder={t("linear.field.team.search")} />
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
                <CommandEmpty>{t("linear.field.team.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((team) => {
                    const selected = value?.teamId === team.id;
                    return (
                      <CommandItem
                        key={team.id}
                        value={`${team.key} ${team.name}`}
                        onSelect={() => {
                          onChange(
                            selected
                              ? null
                              : { teamId: team.id, teamName: team.name, teamKey: team.key },
                          );
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                        <span className="truncate">{team.key} — {team.name}</span>
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
