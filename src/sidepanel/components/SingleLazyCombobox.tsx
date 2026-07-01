import { useState, type ReactNode } from "react";
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
import { orderSelectedFirst } from "@/sidepanel/components/ccOptions";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";

// open 시 목록을 1회 lazy load하는 단일선택 콤보박스 공용 컴포넌트.
// 스코프가 바뀌면 부모가 load(useCallback) 식별자를 갱신해 useLazyListOnOpen이 후보를 리셋한다.
interface Props<T> {
  disabled: boolean;
  load: () => Promise<T[]>;
  getKey: (item: T) => string;
  getName: (item: T) => string;
  // CommandItem의 cmdk 식별자(value). 미지정 시 getName. 검색 필터는 항상 getName 기준.
  getItemValue?: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  selectedKey: string | null;
  onSelect: (item: T | null) => void;
  triggerLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  // 선택 항목을 목록 최상단으로 고정 (유저 검색 필드 공통 정책).
  pinSelected?: boolean;
}

export function SingleLazyCombobox<T>({
  disabled,
  load,
  getKey,
  getName,
  getItemValue,
  renderItem,
  selectedKey,
  onSelect,
  triggerLabel,
  searchPlaceholder,
  emptyLabel,
  pinSelected,
}: Props<T>) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { items, loading, error } = useLazyListOnOpen(open, !disabled, load);

  const q = query.trim().toLowerCase();
  const matched = q
    ? items.filter((it) => getName(it).toLowerCase().includes(q))
    : items;
  const filtered = pinSelected
    ? orderSelectedFirst(matched, (it) => getKey(it) === selectedKey)
    : matched;

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
              selectedKey === null && "text-muted-foreground",
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
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
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
                <CommandEmpty>{emptyLabel}</CommandEmpty>
                <CommandGroup>
                  {filtered.map((it) => {
                    const selected = getKey(it) === selectedKey;
                    return (
                      <CommandItem
                        key={getKey(it)}
                        value={getItemValue ? getItemValue(it) : getName(it)}
                        onSelect={() => {
                          onSelect(selected ? null : it);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {renderItem ? (
                          renderItem(it)
                        ) : (
                          <span className="truncate">{getName(it)}</span>
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
