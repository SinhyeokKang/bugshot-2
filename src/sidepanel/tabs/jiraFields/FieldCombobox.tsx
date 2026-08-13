import type { ReactNode } from "react";
import { ChevronsUpDown, Loader2, X } from "lucide-react";
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

export function FieldCombobox({
  open,
  onOpenChange,
  loading,
  error,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  label,
  fallbackLabel,
  clearable,
  onClear,
  onSearch,
  groupLabel,
  ariaLabel,
  testId,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  label?: string;
  fallbackLabel?: string;
  clearable?: boolean;
  onClear?: () => void;
  onSearch?: (query: string) => void;
  groupLabel?: string;
  // FieldRow의 <label>은 htmlFor로 연결되지 않아 콤보에 접근 이름이 없다. 행이 여럿이면
  // 이름 없는 combobox가 그 수만큼 나열되므로 필요한 필드가 직접 붙인다.
  ariaLabel?: string;
  testId?: string;
  // 닫히면서 트리거로 포커스를 되돌리는 시점. 이 콤보를 닫고 곧바로 다른 콤보를 여는 흐름은
  // 여기서 preventDefault를 해야 새로 열린 레이어가 포커스 복원에 dismiss되지 않는다.
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          data-testid={testId}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !label && !fallbackLabel && "text-muted-foreground",
            )}
          >
            {label || fallbackLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
        onCloseAutoFocus={onCloseAutoFocus}
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
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            ) : (
              <>
                {clearable && onClear ? (
                  <CommandGroup heading={t("common.actions")}>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => {
                        onClear();
                        onOpenChange(false);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="text-xs">{t("common.deselect")}</span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup heading={groupLabel}>{children}</CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
