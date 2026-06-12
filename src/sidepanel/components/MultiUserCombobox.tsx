import { useState } from "react";
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

export interface MultiUserOption {
  key: string;
  label: string;
  avatarUrl?: string;
}

interface Props {
  options: MultiUserOption[];
  // 옵션 lazy load 전에도 트리거에 이름을 보여야 하므로 key+label 쌍으로 받는다 (Jira fallbackLabel 패턴).
  selected: MultiUserOption[];
  onToggle: (option: MultiUserOption) => void;
  onClear: () => void;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  disabledLabel?: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  onOpenChange?: (open: boolean) => void;
  onSearch?: (query: string) => void;
}

export function MultiUserCombobox({
  options,
  selected,
  onToggle,
  onClear,
  loading,
  error,
  disabled,
  disabledLabel,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  onOpenChange,
  onSearch,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selectedKeys = new Set(selected.map((s) => s.key));

  function handleOpenChange(next: boolean) {
    if (disabled) return;
    setOpen(next);
    onOpenChange?.(next);
  }

  const triggerLabel = (() => {
    if (disabled) return disabledLabel ?? placeholder;
    if (selected.length === 0) return placeholder;
    const names = selected.map((s) => s.label);
    if (names.length <= 2) return names.join(", ");
    return t("field.cc.more", {
      names: names.slice(0, 2).join(", "),
      count: names.length - 2,
    });
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
        <Command shouldFilter={!onSearch}>
          <CommandInput
            placeholder={searchPlaceholder}
            onValueChange={onSearch}
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
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                {selected.length > 0 ? (
                  <CommandGroup heading={t("common.actions")}>
                    <CommandItem value="__clear__" onSelect={onClear}>
                      <X className="h-3.5 w-3.5" />
                      <span className="text-xs">{t("field.cc.clear")}</span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandGroup>
                  {options.map((o) => {
                    const sel = selectedKeys.has(o.key);
                    return (
                      <CommandItem
                        key={o.key}
                        // 동명이인 구분 — cmdk는 value로 아이템을 식별하므로 label만 쓰면 충돌.
                        value={`${o.label} ${o.key}`}
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
                        <span className="truncate">{o.label}</span>
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
