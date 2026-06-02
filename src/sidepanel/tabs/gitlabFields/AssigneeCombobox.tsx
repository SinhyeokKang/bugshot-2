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
import type { GitlabMember } from "@/types/gitlab";
import { sendBg } from "@/types/messages";

export interface AssigneeValue {
  id: number;
  username: string;
}

interface Props {
  projectId: number | undefined;
  value: AssigneeValue | null;
  onChange: (next: AssigneeValue | null) => void;
}

export function AssigneeCombobox({ projectId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GitlabMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!projectId;

  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<GitlabMember[]>({
      type: "gitlab.searchAssignees",
      projectId: projectId!,
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
  }, [open, ready, projectId, items.length]);

  useEffect(() => {
    setItems([]);
  }, [projectId]);

  const triggerLabel = (() => {
    if (!ready) return t("gitlab.field.requireProject");
    if (!value) return t("gitlab.field.assignee.placeholder");
    return value.username;
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
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !value && "text-muted-foreground",
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
          <CommandInput placeholder={t("gitlab.field.assignee.search")} />
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
                <CommandEmpty>{t("gitlab.field.assignee.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((u) => {
                    const isSelected = value?.id === u.id;
                    return (
                      <CommandItem
                        key={u.id}
                        value={u.username}
                        onSelect={() => {
                          onChange(
                            isSelected ? null : { id: u.id, username: u.username },
                          );
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt=""
                            className="mr-2 h-4 w-4 rounded-full"
                          />
                        ) : null}
                        <span className="truncate">{u.username}</span>
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
