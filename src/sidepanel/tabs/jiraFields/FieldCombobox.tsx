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
