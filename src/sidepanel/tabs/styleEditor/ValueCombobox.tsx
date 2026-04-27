import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, PenLine, RotateCcw, X } from "lucide-react";
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
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor-store";
import type { Token, TokenCategory } from "@/types/picker";
import { isKnownDefault, PROP_CATEGORY } from "./propMetadata";
import { useStyleProp } from "./styleHooks";
import { TokenChip, TokenItem } from "./TokenChip";
import {
  extractTokenRefs,
  findTokenValue,
  isInternalToken,
  isTokenValue,
  tokenFamilyPrefix,
} from "./tokenUtils";

export function ValueCombobox({
  prop,
  compact,
  icon,
  iconTitle,
  onLinkedCommit,
  controlled,
}: {
  prop: string;
  compact?: boolean;
  icon?: React.ReactNode;
  iconTitle?: string;
  onLinkedCommit?: (value: string) => void;
  controlled?: { value: string; placeholder: string; set: (v: string) => void };
}) {
  const t = useT();
  const styleProp = useStyleProp(prop);
  const value = controlled?.value ?? styleProp.value;
  const placeholder = controlled?.placeholder ?? styleProp.placeholder;
  const set = controlled?.set ?? styleProp.set;
  const computed = useEditorStore(
    (s) => s.selection?.computedStyles[prop] ?? "",
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showAll, setShowAll] = useState(false);
  const prevValue = useRef(value);
  if (prevValue.current !== value) {
    prevValue.current = value;
    setDraft(value);
  }
  const allTokens = useEditorStore((s) => s.tokens);
  const tokens = useMemo(
    () => allTokens.filter((t) => !isInternalToken(t.name)),
    [allTokens],
  );
  const category = PROP_CATEGORY[prop];

  const tokenRefs = extractTokenRefs(value);
  const placeholderTokenRefs = !value ? extractTokenRefs(placeholder) : [];
  const tokenNames = tokenRefs.map((r) => r.name);
  const placeholderTokenNames = placeholderTokenRefs.map((r) => r.name);
  const isDefault = !value && isKnownDefault(prop, placeholder);
  const activeTokenNames = tokenNames.length > 0 ? tokenNames : placeholderTokenNames;
  const liveFamilyPrefixes = useMemo(() => {
    const prefixes: string[] = [];
    for (const n of activeTokenNames) {
      const p = tokenFamilyPrefix(n, tokens);
      if (p && !prefixes.includes(p)) prefixes.push(p);
    }
    return prefixes;
  }, [activeTokenNames, tokens]);
  const [pinnedPrefixes, setPinnedPrefixes] = useState<string[] | null>(null);
  const familyPrefixes = pinnedPrefixes ?? liveFamilyPrefixes;

  const draftLooksLikeToken = /^var\(/.test(draft.trim());


  const { familyGroups, primary, extra } = useMemo(() => {
    const base = !category ? tokens : tokens.filter((t) => t.category === category);
    const others = category
      ? tokens.filter((t) => t.category !== category && t.category !== "unknown")
      : ([] as Token[]);
    if (familyPrefixes.length === 0)
      return { familyGroups: [] as { prefix: string; tokens: Token[] }[], primary: base, extra: others };
    const groups = familyPrefixes.map((p) => ({
      prefix: p,
      tokens: base.filter((t) => t.name.startsWith(p)),
    }));
    const familySet = new Set(groups.flatMap((g) => g.tokens.map((t) => t.name)));
    return {
      familyGroups: groups,
      primary: base.filter((t) => !familySet.has(t.name)),
      extra: others,
    };
  }, [tokens, category, familyPrefixes]);

  const filterTokens = useCallback(
    (list: Token[]) => {
      const q = draft.trim().toLowerCase();
      if (!q || draftLooksLikeToken) return list;
      return list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.value.toLowerCase().includes(q),
      );
    },
    [draft, draftLooksLikeToken],
  );

  const familyGroupsFiltered = useMemo(
    () =>
      familyGroups
        .map((g) => ({ prefix: g.prefix, tokens: filterTokens(g.tokens) }))
        .filter((g) => g.tokens.length > 0),
    [familyGroups, filterTokens],
  );
  const primaryFiltered = useMemo(
    () => filterTokens(primary),
    [primary, filterTokens],
  );
  const extraFiltered = useMemo(
    () => filterTokens(extra),
    [extra, filterTokens],
  );

  const commit = (next: string) => {
    if (onLinkedCommit) onLinkedCommit(next);
    else set(next);
    setOpen(false);
  };

  const onTokenSelect = commit;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraft(tokenNames.length > 0 ? "" : value);
      setShowAll(false);
      setPinnedPrefixes(liveFamilyPrefixes);
    } else {
      setPinnedPrefixes(null);
    }
    setOpen(nextOpen);
  };

  const showRawItem = draft.trim().length > 0 && !draftLooksLikeToken;
  const effectiveShowAll = showAll || draft.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center rounded-md border px-2 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring",
            compact && "px-1.5 gap-1",
          )}
          title={buildTriggerTitle({
            iconTitle,
            value,
            placeholder,
            computed: showComputedHint(category, computed) ? computed : "",
          })}
        >
          {icon ? (
            <span className="shrink-0 text-muted-foreground">{icon}</span>
          ) : null}
          {tokenRefs.length > 0 ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {tokenRefs.map((ref) => (
                <TokenChip
                  key={`${ref.name}:${ref.multiplier ?? ""}`}
                  name={ref.name}
                  multiplier={ref.multiplier}
                  swatch={
                    category === "color" || category === "image"
                      ? findTokenValue(tokens, ref.name)
                      : undefined
                  }
                  swatchKind={category === "image" ? "image" : "color"}
                  compact={compact}
                />
              ))}
              {!compact && showComputedHint(category, computed) ? (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                  {computed}
                </span>
              ) : null}
            </span>
          ) : value ? (
            <span className="min-w-0 flex-1 truncate text-left">{value}</span>
          ) : placeholderTokenRefs.length > 0 ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {placeholderTokenRefs.map((ref) => (
                <TokenChip
                  key={`${ref.name}:${ref.multiplier ?? ""}`}
                  name={ref.name}
                  multiplier={ref.multiplier}
                  swatch={
                    category === "color" || category === "image"
                      ? findTokenValue(tokens, ref.name)
                      : undefined
                  }
                  swatchKind={category === "image" ? "image" : "color"}
                  compact={compact}
                />
              ))}
              {!compact && showComputedHint(category, computed) ? (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                  {computed}
                </span>
              ) : null}
            </span>
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                isDefault
                  ? "text-muted-foreground/50"
                  : "text-muted-foreground",
              )}
            >
              {compact && placeholder
                ? shortValue(placeholder)
                : placeholder || "—"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "rounded-lg p-0",
          compact
            ? "w-[calc(var(--radix-popover-trigger-width)*2)]"
            : "w-[var(--radix-popover-trigger-width)]",
        )}
        align="start"
        sideOffset={2}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("value.placeholder")}
            value={draft}
            onValueChange={(v) => {
              setDraft(v);
              if (onLinkedCommit) onLinkedCommit(v.trim());
              else set(v.trim());
            }}
            icon={<PenLine className="mr-2 h-4 w-4 shrink-0 opacity-50" />}
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          <CommandList>
            {value || placeholder ? (
              <CommandGroup heading={t("common.actions")}>
                {value ? (
                  <CommandItem value="__clear__" onSelect={() => commit("")}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="text-xs">{t("value.reset")}</span>
                  </CommandItem>
                ) : null}
                {value !== "unset" ? (
                  <CommandItem value="__unset__" onSelect={() => commit("unset")}>
                    <X className="h-3.5 w-3.5" />
                    <span className="text-xs">{t("value.unset")}</span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}
            {showRawItem && !draftLooksLikeToken ? (
              <CommandGroup heading={t("value.manualInput")}>
                <CommandItem
                  value={`__raw__${draft}`}
                  onSelect={() => commit(draft.trim())}
                >
                  <span className="text-sm">{draft.trim()}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {familyGroupsFiltered.map((g) => (
              <CommandGroup key={g.prefix} heading={g.prefix}>
                {g.tokens.map((t) => (
                  <TokenItem
                    key={t.name}
                    token={t}
                    active={activeTokenNames.includes(t.name)}
                    onCommit={onTokenSelect}
                  />
                ))}
              </CommandGroup>
            ))}
            <CommandGroup
              heading={`토큰${category ? ` · ${category}` : ""}`}
            >
              {familyGroupsFiltered.length === 0 && primaryFiltered.length === 0 && extraFiltered.length === 0 ? (
                <CommandEmpty>{t("value.noMatch")}</CommandEmpty>
              ) : null}
              {primaryFiltered.map((t) => (
                <TokenItem
                  key={t.name}
                  token={t}
                  active={activeTokenNames.includes(t.name)}
                  onCommit={onTokenSelect}
                />
              ))}
              {category && extraFiltered.length > 0 && !effectiveShowAll ? (
                <CommandItem
                  value="__show_all_tokens__"
                  onSelect={() => setShowAll(true)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span className="text-xs text-muted-foreground">
                    {t("value.showMore", { count: extraFiltered.length })}
                  </span>
                </CommandItem>
              ) : null}
            </CommandGroup>
            {effectiveShowAll && extraFiltered.length > 0 ? (
              <CommandGroup heading={t("value.otherTokens")}>
                {extraFiltered.map((t) => (
                  <TokenItem
                  key={t.name}
                  token={t}
                  active={activeTokenNames.includes(t.name)}
                  onCommit={onTokenSelect}
                />
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function showComputedHint(
  category: TokenCategory | undefined,
  computed: string,
): boolean {
  if (!computed) return false;
  if (isTokenValue(computed)) return false;
  return category === "length" || category === "number";
}

function buildTriggerTitle({
  iconTitle,
  value,
  placeholder,
  computed,
}: {
  iconTitle?: string;
  value: string;
  placeholder: string;
  computed: string;
}): string {
  const main = value || placeholder;
  const tail =
    computed && computed !== main && !isTokenValue(computed)
      ? ` (${computed})`
      : "";
  const body = `${main}${tail}`;
  return iconTitle ? `${iconTitle} · ${body}` : body;
}

function shortValue(v: string): string {
  if (v.endsWith("px")) {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return `${n}`;
  }
  return v;
}
