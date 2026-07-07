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
import { ColorSwatch } from "@/sidepanel/components/ColorSwatch";
import { useEditorStore } from "@/store/editor-store";
import type { Token, TokenCategory } from "@/types/picker";
import { isRenderableColorLiteral } from "./colorLiteral";
import {
  applyMultiplier,
  finalizeLiveValue,
  finalizeValue,
  rightHintText,
  shortValue,
} from "./valueFormat";
import {
  isInactiveBorderColor,
  isKnownDefault,
  PROP_CATEGORY,
} from "./propMetadata";
import { useStyleProp } from "./styleHooks";
import { TokenChip, TokenItem } from "./TokenChip";
import {
  extractTokenRefs,
  findTokenValue,
  isInternalToken,
  isTokenValue,
} from "./tokenUtils";
import {
  filterTokensByQuery,
  groupTokensByFamily,
  tokenFamilyPrefixes,
} from "./tokenSuggest";

export function ValueCombobox({
  prop,
  compact,
  icon,
  iconTitle,
  controlled,
}: {
  prop: string;
  compact?: boolean;
  icon?: React.ReactNode;
  iconTitle?: string;
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
  const computedStyles = useEditorStore((s) => s.selection?.computedStyles);
  const isSpecified = useEditorStore(
    (s) => prop in (s.selection?.specifiedStyles ?? {}),
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
  const isDefault =
    !value &&
    (isKnownDefault(prop, placeholder) ||
      (!isSpecified && isInactiveBorderColor(prop, computedStyles ?? {})));
  const activeTokenNames = tokenNames.length > 0 ? tokenNames : placeholderTokenNames;
  const liveFamilyPrefixes = useMemo(
    () => tokenFamilyPrefixes(activeTokenNames, tokens),
    [activeTokenNames, tokens],
  );
  const [pinnedPrefixes, setPinnedPrefixes] = useState<string[] | null>(null);
  const familyPrefixes = pinnedPrefixes ?? liveFamilyPrefixes;

  const draftLooksLikeToken = /^var\(/.test(draft.trim());

  const { familyGroups, primary, extra } = useMemo(
    () => groupTokensByFamily(tokens, category, familyPrefixes),
    [tokens, category, familyPrefixes],
  );

  const filterTokens = useCallback(
    (list: Token[]) =>
      filterTokensByQuery(list, draftLooksLikeToken ? "" : draft),
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

  const finalize = useCallback(
    (next: string) => finalizeValue(category, next, prop),
    [category, prop],
  );

  const commit = (next: string) => {
    set(finalize(next));
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
      const finalized = finalize(draft.trim());
      if (finalized && finalized !== value) set(finalized);
    }
    setOpen(nextOpen);
  };

  const showRawItem = draft.trim().length > 0 && !draftLooksLikeToken;
  const effectiveShowAll = showAll || draft.trim().length > 0;

  const valueTokenHint = rightHintText(
    category,
    computed,
    applyMultiplier(
      findTokenValue(tokens, tokenRefs[0]?.name),
      tokenRefs[0]?.multiplier,
    ),
    !!compact,
  );
  const placeholderTokenHint = rightHintText(
    category,
    computed,
    applyMultiplier(
      findTokenValue(tokens, placeholderTokenRefs[0]?.name),
      placeholderTokenRefs[0]?.multiplier,
    ),
    !!compact,
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center rounded-md border px-2 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
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
              {valueTokenHint != null ? (
                <span
                  data-testid="token-value-hint"
                  className="ml-auto max-w-[120px] shrink-0 truncate text-[10px] text-muted-foreground/70"
                >
                  {valueTokenHint}
                </span>
              ) : null}
            </span>
          ) : value ? (
            category === "color" && isRenderableColorLiteral(value) ? (
              <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                <ColorSwatch color={value} />
                <span className="min-w-0 flex-1 truncate text-left">{value}</span>
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-left">{value}</span>
            )
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
              {placeholderTokenHint != null ? (
                <span
                  data-testid="token-value-hint"
                  className="ml-auto max-w-[120px] shrink-0 truncate text-[10px] text-muted-foreground/70"
                >
                  {placeholderTokenHint}
                </span>
              ) : null}
            </span>
          ) : category === "color" &&
            placeholder &&
            isRenderableColorLiteral(placeholder) ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <ColorSwatch color={placeholder} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left",
                  isDefault
                    ? "text-muted-foreground/50"
                    : "text-muted-foreground",
                )}
              >
                {compact ? shortValue(placeholder) : placeholder}
              </span>
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
              // 라이브 적용은 finalizeLiveValue — color 단축 hex는 blur 전까지 확장하지
              // 않아 입력 중 깜빡임을 막는다(commit/blur는 finalize로 확장).
              const normalized = finalizeLiveValue(category, v.trim(), prop);
              // 정규화값은 페이지에 라이브 적용하되 입력란(draft)은 raw 유지 —
              // 내가 일으킨 value 변경은 prevValue를 미리 맞춰 리싱크(60행)에서 제외한다.
              prevValue.current = normalized;
              set(normalized);
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
            {showRawItem ? (
              <CommandGroup heading={t("value.manualInput")}>
                <CommandItem
                  value={`__raw__${finalize(draft.trim())}`}
                  onSelect={() => commit(draft.trim())}
                >
                  {category === "color" &&
                  isRenderableColorLiteral(finalize(draft.trim())) ? (
                    <ColorSwatch color={finalize(draft.trim())} />
                  ) : null}
                  <span className="text-sm">{finalize(draft.trim())}</span>
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
              heading={`${t("value.tokens")}${category ? ` · ${category}` : ""}`}
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

