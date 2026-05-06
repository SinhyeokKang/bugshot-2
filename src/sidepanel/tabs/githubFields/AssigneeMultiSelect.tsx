import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
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
import type { GithubUser } from "@/types/github";
import { sendBg } from "@/types/messages";

interface Props {
  owner: string | undefined;
  repo: string | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}

export function AssigneeMultiSelect({ owner, repo, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GithubUser[]>([]);
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
    sendBg<GithubUser[]>({
      type: "github.searchAssignees",
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

  function toggle(login: string) {
    if (value.includes(login)) {
      onChange(value.filter((v) => v !== login));
    } else {
      onChange([...value, login]);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Popover open={open} onOpenChange={(v) => ready && setOpen(v)}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={!ready}
            className="w-full justify-between font-normal"
          >
            <span className={cn("min-w-0 flex-1 truncate text-left", value.length === 0 && "text-muted-foreground")}>
              {!ready
                ? t("github.field.requireRepo")
                : value.length === 0
                  ? t("github.field.assignees.placeholder")
                  : `${value.length} selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onWheel={(e) => e.stopPropagation()}
        >
          <Command>
            <CommandInput placeholder={t("github.field.assignees.search")} />
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
                  <CommandEmpty>{t("github.field.assignees.empty")}</CommandEmpty>
                  <CommandGroup>
                    {items.map((u) => {
                      const checked = value.includes(u.login);
                      return (
                        <CommandItem
                          key={u.id}
                          value={u.login}
                          onSelect={() => toggle(u.login)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              checked ? "opacity-100" : "opacity-0",
                            )}
                          />
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt=""
                              className="mr-2 h-5 w-5 rounded-full"
                            />
                          ) : null}
                          <span className="truncate">{u.login}</span>
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

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {value.map((login) => (
            <span
              key={login}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-[11px]"
            >
              {login}
              <button
                type="button"
                onClick={() => toggle(login)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
