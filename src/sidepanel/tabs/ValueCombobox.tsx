import { useMemo, useState } from "react";
import { Check, ChevronDown, PenLine, RotateCcw, X } from "lucide-react";
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
import { useEditorStore } from "@/store/editor-store";
import type { Token, TokenCategory } from "@/types/picker";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { applyStyles } from "../picker-control";

const PROP_CATEGORY: Record<string, TokenCategory> = {
  color: "color",
  "background-color": "color",
  "border-color": "color",
  "font-size": "length",
  "line-height": "length",
  "letter-spacing": "length",
  margin: "length",
  "margin-top": "length",
  "margin-right": "length",
  "margin-bottom": "length",
  "margin-left": "length",
  padding: "length",
  "padding-top": "length",
  "padding-right": "length",
  "padding-bottom": "length",
  "padding-left": "length",
  gap: "length",
  "row-gap": "length",
  "column-gap": "length",
  width: "length",
  height: "length",
  "min-width": "length",
  "max-width": "length",
  "min-height": "length",
  "max-height": "length",
  "border-radius": "length",
  "border-top-left-radius": "length",
  "border-top-right-radius": "length",
  "border-bottom-right-radius": "length",
  "border-bottom-left-radius": "length",
  "font-weight": "number",
  opacity: "number",
};

const KNOWN_DEFAULTS: Record<string, string[]> = {
  "margin-top": ["0px"],
  "margin-right": ["0px"],
  "margin-bottom": ["0px"],
  "margin-left": ["0px"],
  "padding-top": ["0px"],
  "padding-right": ["0px"],
  "padding-bottom": ["0px"],
  "padding-left": ["0px"],
  gap: ["normal", "0px", "0px 0px"],
  "row-gap": ["normal", "0px"],
  "column-gap": ["normal", "0px"],
  "letter-spacing": ["normal"],
  "line-height": ["normal"],
  "text-align": ["start", "left"],
  position: ["static"],
  "flex-direction": ["row"],
  "flex-wrap": ["nowrap"],
  "justify-content": ["normal", "flex-start", "start"],
  "align-items": ["normal", "stretch", "start"],
  opacity: ["1"],
  "background-color": ["rgba(0, 0, 0, 0)", "transparent"],
  "border-color": ["rgb(0, 0, 0)", "currentcolor"],
  "border-radius": ["0px"],
  "border-top-left-radius": ["0px"],
  "border-top-right-radius": ["0px"],
  "border-bottom-right-radius": ["0px"],
  "border-bottom-left-radius": ["0px"],
  border: ["", "0px none rgb(0, 0, 0)", "none"],
  "min-width": ["auto", "0px"],
  "max-width": ["none"],
  "min-height": ["auto", "0px"],
  "max-height": ["none"],
  width: ["auto"],
  height: ["auto"],
  overflow: ["visible"],
  "overflow-x": ["visible"],
  "overflow-y": ["visible"],
  "text-overflow": ["clip"],
  "white-space": ["normal"],
  "box-shadow": ["none"],
  filter: ["none"],
  "backdrop-filter": ["none"],
  "mix-blend-mode": ["normal"],
};

export function useStyleProp(prop: string) {
  const value = useEditorStore(
    (s) => s.styleEdits.inlineStyle[prop] ?? "",
  );
  const specified = useEditorStore(
    (s) => s.selection?.specifiedStyles[prop] ?? "",
  );
  const computed = useEditorStore(
    (s) => s.selection?.computedStyles[prop] ?? "",
  );
  const placeholder = specified || computed;
  const tabId = useBoundTabId();

  const set = (next: string) => {
    const current = useEditorStore.getState().styleEdits.inlineStyle;
    const nextInline = { ...current };
    if (next === "") delete nextInline[prop];
    else nextInline[prop] = next;
    useEditorStore.getState().setStyleEdits({ inlineStyle: nextInline });
    if (tabId) void applyStyles(tabId, nextInline);
  };

  return { value, placeholder, set };
}

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
  const styleProp = useStyleProp(prop);
  const value = controlled?.value ?? styleProp.value;
  const placeholder = controlled?.placeholder ?? styleProp.placeholder;
  const set = controlled?.set ?? styleProp.set;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showAll, setShowAll] = useState(false);
  const tokens = useEditorStore((s) => s.tokens);
  const category = PROP_CATEGORY[prop];

  const tokenNames = extractAllTokenNames(value);
  const placeholderTokenNames = !value ? extractAllTokenNames(placeholder) : [];
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

  const filterTokens = (list: Token[]) => {
    const q = draft.trim().toLowerCase();
    if (!q || draftLooksLikeToken) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.value.toLowerCase().includes(q),
    );
  };

  const familyGroupsFiltered = useMemo(
    () =>
      familyGroups
        .map((g) => ({ prefix: g.prefix, tokens: filterTokens(g.tokens) }))
        .filter((g) => g.tokens.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyGroups, draft, draftLooksLikeToken],
  );
  const primaryFiltered = useMemo(
    () => filterTokens(primary),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primary, draft, draftLooksLikeToken],
  );
  const extraFiltered = useMemo(
    () => filterTokens(extra),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extra, draft, draftLooksLikeToken],
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
          title={iconTitle ? `${iconTitle} · ${value || placeholder}` : value || placeholder}
        >
          {icon ? (
            <span className="shrink-0 text-muted-foreground">{icon}</span>
          ) : null}
          {tokenNames.length > 0 ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {tokenNames.map((tn) => (
                <TokenChip
                  key={tn}
                  name={tn}
                  swatch={
                    category === "color"
                      ? findTokenValue(tokens, tn)
                      : undefined
                  }
                  compact={compact}
                />
              ))}
            </span>
          ) : value ? (
            <span className="min-w-0 flex-1 truncate text-left">{value}</span>
          ) : placeholderTokenNames.length > 0 ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {placeholderTokenNames.map((tn) => (
                <TokenChip
                  key={tn}
                  name={tn}
                  swatch={
                    category === "color"
                      ? findTokenValue(tokens, tn)
                      : undefined
                  }
                  compact={compact}
                />
              ))}
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
            placeholder="값 직접 입력 또는 토큰 검색"
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
              <CommandGroup heading="동작">
                {value ? (
                  <CommandItem value="__clear__" onSelect={() => commit("")}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="text-xs">원래 값 (reset)</span>
                  </CommandItem>
                ) : null}
                {value !== "unset" ? (
                  <CommandItem value="__unset__" onSelect={() => commit("unset")}>
                    <X className="h-3.5 w-3.5" />
                    <span className="text-xs">값 해제 (unset)</span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}
            {showRawItem && !draftLooksLikeToken ? (
              <CommandGroup heading="직접 입력">
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
                <CommandEmpty>매칭 없음</CommandEmpty>
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
                    다른 토큰 {extraFiltered.length}개 더 보기
                  </span>
                </CommandItem>
              ) : null}
            </CommandGroup>
            {effectiveShowAll && extraFiltered.length > 0 ? (
              <CommandGroup heading="기타 토큰">
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

function TokenItem({
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
        <span
          className="h-3 w-3 shrink-0 rounded border"
          style={{ backgroundColor: token.value }}
        />
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

function TokenChip({
  name,
  swatch,
  compact,
}: {
  name: string;
  swatch?: string;
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
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border/60"
          style={{ backgroundColor: swatch }}
        />
      ) : null}
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

function shortValue(v: string): string {
  if (v.endsWith("px")) {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return `${n}`;
  }
  return v;
}

function extractAllTokenNames(value: string): string[] {
  const re = /var\(\s*(--[^\s,)]+)/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) names.push(m[1]);
  return names;
}

function tokenFamilyPrefix(
  name: string,
  allTokens: Token[],
): string | null {
  let end = name.lastIndexOf("-");
  while (end > 2) {
    const prefix = name.slice(0, end + 1);
    const count = allTokens.filter((t) => t.name.startsWith(prefix)).length;
    if (count >= 2) return prefix;
    end = name.lastIndexOf("-", end - 1);
  }
  return null;
}

function findTokenValue(tokens: Token[], name: string): string | undefined {
  return tokens.find((t) => t.name === name)?.value;
}

export function isKnownDefault(prop: string, computed: string): boolean {
  const value = computed.trim();
  if (prop === "border" && /^0px\s+none\b/.test(value)) return true;
  const defaults = KNOWN_DEFAULTS[prop];
  if (!defaults) return false;
  return defaults.includes(value);
}
