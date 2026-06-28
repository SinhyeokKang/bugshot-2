import { Check } from "lucide-react";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ColorSwatch } from "@/sidepanel/components/ColorSwatch";
import type { Token } from "@/types/picker";

export function TokenChip({
  name,
  multiplier,
  swatch,
  swatchKind = "color",
  compact,
}: {
  name: string;
  multiplier?: number;
  swatch?: string;
  swatchKind?: "color" | "image";
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-[1px] text-xs text-foreground",
        compact && "px-1",
      )}
    >
      {swatch ? (
        <ColorSwatch
          color={swatchKind === "color" ? swatch : undefined}
          image={swatchKind === "image" ? swatch : undefined}
        />
      ) : null}
      <span className="min-w-0 truncate">{name}</span>
      {multiplier != null ? (
        <span className="shrink-0 text-muted-foreground">×{multiplier}</span>
      ) : null}
    </span>
  );
}

export function TokenItem({
  token,
  active,
  onCommit,
}: {
  token: Token;
  active?: boolean;
  onCommit: (next: string) => void;
}) {
  return (
    <CommandItem
      value={`${token.name} ${token.value}`}
      onSelect={() => onCommit(`var(${token.name})`)}
      className={cn(active && "bg-accent/60 data-[selected=true]:bg-accent")}
    >
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      {token.category === "color" ? (
        <ColorSwatch color={token.value} />
      ) : token.category === "image" ? (
        <ColorSwatch image={token.value} />
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          active && "font-medium",
        )}
      >
        {token.name}
      </span>
      <span className="ml-auto min-w-0 max-w-[120px] shrink-0 truncate text-[11px] text-muted-foreground">
        {token.value}
      </span>
    </CommandItem>
  );
}
