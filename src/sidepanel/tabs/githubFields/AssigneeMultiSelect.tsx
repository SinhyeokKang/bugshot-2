import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { useT } from "@/i18n";
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
          <div
            role="combobox"
            aria-expanded={open}
            aria-disabled={!ready}
            tabIndex={ready ? 0 : -1}
            onKeyDown={(e) => {
              if (!ready) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className={cn(
              "flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm hover:bg-accent hover:text-accent-foreground",
              !ready && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {!ready ? (
                <span className="text-muted-foreground">{t("github.field.requireRepo")}</span>
              ) : value.length === 0 ? (
                <span className="text-muted-foreground">{t("github.field.assignees.placeholder")}</span>
              ) : (
                value.map((login) => (
                  <span
                    key={login}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-[11px] font-normal"
                  >
                    {login}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(login);
                      }}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
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
    </div>
  );
}
