import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { NotionPropertySchema } from "@/types/notion";

interface Props {
  schema: NotionPropertySchema;
  value: string[];
  onChange: (next: string[]) => void;
}

export function PropertySelectCombobox({ schema, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const options = schema.options ?? [];
  const isMulti = schema.type === "multi_select";

  const display =
    value.length === 0
      ? t("notion.field.property.placeholder", { name: schema.name })
      : value.join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
              value.length === 0 && "text-muted-foreground",
            )}
          >
            {display}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandList>
            <CommandEmpty>{t("notion.field.property.empty")}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const selected = value.includes(opt.name);
                return (
                  <CommandItem
                    key={opt.id}
                    value={opt.name}
                    onSelect={() => {
                      if (isMulti) {
                        if (selected) {
                          onChange(value.filter((v) => v !== opt.name));
                        } else {
                          onChange([...value, opt.name]);
                        }
                      } else {
                        onChange(selected ? [] : [opt.name]);
                        setOpen(false);
                      }
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{opt.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
