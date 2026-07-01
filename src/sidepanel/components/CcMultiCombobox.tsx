import { useEffect, useState } from "react";
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
import { pinSelectedFirst, type CcUserOption } from "./ccOptions";

export type { CcUserOption };

interface Props {
  options: CcUserOption[];
  // 옵션 lazy load 전에도 트리거에 이름을 보여야 하므로 key+label 쌍으로 받는다 (Jira fallbackLabel 패턴).
  selected: CcUserOption[];
  onToggle: (option: CcUserOption) => void;
  onClear: () => void;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  disabledLabel?: string;
  onOpenChange?: (open: boolean) => void;
  onSearch?: (query: string) => void;
  // 서버검색형(Jira 등): 이미 선택돼 검색 결과에 없는 유저를 id로 재조회해 아바타·이메일 보강.
  resolveSelected?: (keys: string[]) => Promise<CcUserOption[]>;
  // 멘션 등 CC가 아닌 용도로 재사용할 때 라벨을 덮어쓴다 (기본은 field.cc.*).
  selectLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
}

export function CcMultiCombobox({
  options,
  selected,
  onToggle,
  onClear,
  loading,
  error,
  disabled,
  disabledLabel,
  onOpenChange,
  onSearch,
  resolveSelected,
  selectLabel,
  searchPlaceholder,
  emptyLabel,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resolved, setResolved] = useState<CcUserOption[]>([]);
  const selectedKeys = new Set(selected.map((s) => s.key));
  const searching = query.trim().length > 0;

  // 열릴 때, 검색 결과·기존 resolve 어디에도 없는 선택 유저를 재조회한다.
  useEffect(() => {
    if (!open || !resolveSelected) return;
    const known = new Set([
      ...options.map((o) => o.key),
      ...resolved.map((o) => o.key),
    ]);
    const missing = selected
      .map((s) => s.key)
      .filter((k) => !known.has(k));
    if (missing.length === 0) return;
    let cancelled = false;
    resolveSelected(missing)
      .then((users) => {
        if (!cancelled && users.length > 0) {
          setResolved((prev) => [...prev, ...users]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, options]);

  function handleOpenChange(next: boolean) {
    if (disabled) return;
    setOpen(next);
    onOpenChange?.(next);
  }

  const placeholder = selectLabel ?? t("field.cc.select");

  const triggerLabel = (() => {
    if (disabled) return disabledLabel ?? placeholder;
    if (selected.length === 0) return placeholder;
    return selected.map((s) => s.label).join(", ");
  })();

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid="cc-combobox"
          className="w-full min-w-0 justify-between font-normal"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              selected.length === 0 && "text-muted-foreground",
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
        <Command
          shouldFilter={!onSearch}
          // 동명이인 구분용 key(UUID·gid)가 검색어에 걸리지 않도록 label(keywords)에만 매칭.
          filter={(_value, search, keywords) =>
            keywords?.some((k) =>
              k.toLowerCase().includes(search.toLowerCase()),
            )
              ? 1
              : 0
          }
        >
          <CommandInput
            placeholder={searchPlaceholder ?? t("field.cc.search")}
            onValueChange={(v) => {
              setQuery(v);
              onSearch?.(v);
            }}
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
                <CommandEmpty>{emptyLabel ?? t("field.cc.empty")}</CommandEmpty>
                {selected.length > 0 ? (
                  <CommandGroup heading={t("common.actions")}>
                    <CommandItem value="__clear__" onSelect={onClear}>
                      <X className="h-3.5 w-3.5" />
                      <span className="text-xs">{t("field.cc.clear")}</span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandGroup>
                  {(searching
                    ? options
                    : pinSelectedFirst([...options, ...resolved], selected)
                  ).map((o) => {
                    const sel = selectedKeys.has(o.key);
                    return (
                      <CommandItem
                        key={o.key}
                        value={o.key}
                        keywords={o.email ? [o.label, o.email] : [o.label]}
                        onSelect={() => onToggle(o)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            sel ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {o.avatarUrl ? (
                          <img
                            src={o.avatarUrl}
                            alt=""
                            className="mr-2 h-4 w-4 rounded-full"
                          />
                        ) : null}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{o.label}</span>
                          {o.email ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {o.email}
                            </span>
                          ) : null}
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
