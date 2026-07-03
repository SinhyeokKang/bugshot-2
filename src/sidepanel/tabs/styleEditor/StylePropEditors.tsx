import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Columns2,
  Link,
  RotateCcw,
  Rows2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useEditorStore, type EditorSelection } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { applyStyles } from "@/sidepanel/picker-control";
import { ValueCombobox } from "./ValueCombobox";
import { isKnownDefault } from "./propMetadata";
import { useStyleProp, usePropSource, useCommonPropSource } from "./styleHooks";

export function SectionRevertButton({ props }: { props: readonly string[] }) {
  const t = useT();
  const dirty = useEditorStore((s) =>
    props.some((p) => p in s.styleEdits.inlineStyle),
  );
  const tabId = useBoundTabId();

  const handleRevert = () => {
    const current = useEditorStore.getState().styleEdits.inlineStyle;
    const next = { ...current };
    for (const p of props) delete next[p];
    useEditorStore.getState().setStyleEdits({ inlineStyle: next });
    const frameId = useEditorStore.getState().selection?.frameId ?? 0;
    if (tabId) void applyStyles(tabId, frameId, next);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={handleRevert}
      disabled={!dirty}
      title={t("editor.revertSection")}
      aria-label={t("editor.revertSection")}
      className="h-8 w-8 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}

export function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

// 4면 baseline: 편집값(inlineStyle) → specified → computed 순, 없으면 "".
function sideBaselineValues(
  props: string[],
  inlineStyle: Record<string, string>,
  selection: EditorSelection | null,
): string[] {
  return props.map((p) => {
    if (inlineStyle[p]) return inlineStyle[p];
    if (selection?.specifiedStyles[p]) return selection.specifiedStyles[p];
    if (selection?.computedStyles[p]) return selection.computedStyles[p];
    return "";
  });
}

// 4면 편집값(inlineStyle)이 모두 동일하면 그 값, 일부라도 없거나 다르면 "".
export function commonEditValue(
  props: string[],
  inlineStyle: Record<string, string>,
): string {
  const vals = props.map((p) => inlineStyle[p] ?? "");
  return vals.length > 0 && vals.every((v) => v === vals[0] && v !== "")
    ? vals[0]
    : "";
}

// 4면 baseline이 모두 동일하면 그 값, 아니면 "".
export function commonBaseline(
  props: string[],
  inlineStyle: Record<string, string>,
  selection: EditorSelection | null,
): string {
  const vals = sideBaselineValues(props, inlineStyle, selection);
  return vals.length > 0 && vals.every((v) => v === vals[0] && v !== "")
    ? vals[0]
    : "";
}

// baseline 4면이 서로 다르면 true (전부 같으면 — 빈 값 포함 — false).
export function sidesMixed(
  props: string[],
  inlineStyle: Record<string, string>,
  selection: EditorSelection | null,
): boolean {
  const vals = sideBaselineValues(props, inlineStyle, selection);
  return vals.length > 0 && !vals.every((v) => v === vals[0]);
}

export function sidesAllEqual(
  props: string[],
  inlineStyle: Record<string, string>,
  selection: EditorSelection | null,
): boolean {
  return commonBaseline(props, inlineStyle, selection) !== "";
}

function useLinkedProps(props: string[]) {
  const selection = useEditorStore((s) => s.selection);
  const [linked, setLinked] = useState(() =>
    sidesAllEqual(props, useEditorStore.getState().styleEdits.inlineStyle, selection),
  );
  // 요소가 바뀌면(같은 selector 다른 인스턴스 포함 — capturedAt로 구분) linked 기본값 재판정.
  const selKey = selection ? `${selection.selector}@${selection.capturedAt}` : null;
  useEffect(() => {
    // inlineStyle/selection은 구독값이 아닌 getState로 읽어 deps를 [selKey]로 고정 —
    // 같은 요소에서 편집(inlineStyle 변경) 중엔 재판정 않고 요소 재선택 시에만 재판정한다.
    setLinked(
      sidesAllEqual(
        props,
        useEditorStore.getState().styleEdits.inlineStyle,
        useEditorStore.getState().selection,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);
  const tabId = useBoundTabId();

  const setAllProps = useCallback(
    (value: string) => {
      const current = useEditorStore.getState().styleEdits.inlineStyle;
      const nextInline = { ...current };
      for (const p of props) {
        if (value === "") delete nextInline[p];
        else nextInline[p] = value;
      }
      useEditorStore.getState().setStyleEdits({ inlineStyle: nextInline });
      const frameId = useEditorStore.getState().selection?.frameId ?? 0;
      if (tabId) void applyStyles(tabId, frameId, nextInline);
    },
    [props, tabId],
  );

  return { linked, toggle: () => setLinked((v) => !v), setAllProps };
}

// linked 단일 필드 전용 — merged 상태를 분리 primitive 셀렉터로 구독(객체 단일 셀렉터는
// Object.is 실패로 매 변경 리렌더). 이 훅을 쓰는 컴포넌트는 linked일 때만 마운트돼야
// unlinked에서 불필요 구독이 안 생긴다(useLinkedProps와 분리한 이유).
function useMergedSides(props: string[]) {
  const value = useEditorStore((s) =>
    commonEditValue(props, s.styleEdits.inlineStyle),
  );
  const placeholder = useEditorStore((s) =>
    commonBaseline(props, s.styleEdits.inlineStyle, s.selection),
  );
  const mixed = useEditorStore((s) =>
    sidesMixed(props, s.styleEdits.inlineStyle, s.selection),
  );
  return { value, placeholder, mixed };
}

function LinkToggle({
  linked,
  onToggle,
}: {
  linked: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={linked}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-foreground transition-colors",
        linked ? "border-foreground bg-foreground text-background hover:bg-foreground/80" : "hover:bg-muted",
      )}
      title={linked ? t("prop.editIndividual") : t("prop.editTogether")}
      aria-label={linked ? t("prop.editIndividual") : t("prop.editTogether")}
    >
      {linked ? (
        <Link className="h-3.5 w-3.5" />
      ) : (
        <Unlink className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function PropRow({
  label,
  source,
  children,
}: {
  label: string;
  source?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-xs text-muted-foreground"
        title={source ? t("prop.source", { value: source }) : undefined}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function TextProp({ label, prop }: { label: string; prop: string }) {
  const source = usePropSource(prop);
  return (
    <PropRow label={label} source={source}>
      <ValueCombobox prop={prop} />
    </PropRow>
  );
}

function splitShadowLayers(raw: string): string[] {
  if (!raw || raw === "none") return [];
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of raw) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter((layer) => !isInternalOnlyLayer(layer));
}

function isInternalOnlyLayer(layer: string): boolean {
  const refs = layer.match(/var\(\s*(--[^\s,)]+)/g);
  if (!refs || refs.length === 0) return false;
  return refs.every((r) =>
    r.replace(/var\(\s*/, "").startsWith("--tw-"),
  );
}

export function BoxShadowProp() {
  const { value, placeholder, set } = useStyleProp("box-shadow");
  const source = usePropSource("box-shadow");

  const valueParts = useMemo(() => splitShadowLayers(value), [value]);
  const placeholderParts = useMemo(() => splitShadowLayers(placeholder), [placeholder]);
  const count = Math.max(valueParts.length, placeholderParts.length, 1);

  const setLayer = (i: number, v: string) => {
    const parts =
      valueParts.length > 0
        ? [...valueParts]
        : [...placeholderParts];
    while (parts.length < count) parts.push("");
    parts[i] = v;
    const cleaned = parts.filter(Boolean);
    set(cleaned.length > 0 ? cleaned.join(", ") : "");
  };

  return (
    <PropRow label="box-shadow" source={source}>
      <div className="flex flex-col gap-1">
        {Array.from({ length: count }, (_, i) => (
          <ValueCombobox
            key={i}
            prop="box-shadow"
            controlled={{
              value: valueParts[i] ?? "",
              placeholder: placeholderParts[i] ?? "",
              set: (v) => setLayer(i, v),
            }}
          />
        ))}
      </div>
    </PropRow>
  );
}

export function SelectProp({
  label,
  prop,
  options,
}: {
  label: string;
  prop: string;
  options: string[];
}) {
  const { value, placeholder, set } = useStyleProp(prop);
  const source = usePropSource(prop);
  const isDefault = !value && isKnownDefault(prop, placeholder);
  return (
    <PropRow label={label} source={source}>
      <Select value={value} onValueChange={(v) => set(v === "__empty__" ? "" : v)}>
        <SelectTrigger
          className={cn(
            "h-9 w-full",
            !value && "text-muted-foreground",
            isDefault && "text-muted-foreground/50",
          )}
        >
          <SelectValue placeholder={`(${placeholder || "none"})`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o || "__empty__"}>
              {o || `(${placeholder || "none"})`}
            </SelectItem>
          ))}
          {!options.includes("unset") ? (
            <SelectItem value="unset">unset</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </PropRow>
  );
}

export function AlignmentProp({ label, prop }: { label: string; prop: string }) {
  const t = useT();
  const { value, placeholder, set } = useStyleProp(prop);
  const source = usePropSource(prop);
  // Radix Tabs는 pointerdown에서 값을 바꾸고 활성 탭 재클릭 시엔 onValueChange를 안 쏜다.
  // click 시점엔 이미 리렌더돼 새 값이라 판정이 불가능 — pointerdown(리렌더 전) 상태를 캡처한다.
  const preClick = useRef({ hadEdit: false, resolved: "" });
  const current = (value || placeholder || "").trim();
  const options: { v: string; icon: React.ReactNode; title: string }[] = [
    { v: "left", icon: <AlignLeft className="h-4 w-4" />, title: t("prop.align.left") },
    { v: "center", icon: <AlignCenter className="h-4 w-4" />, title: t("prop.align.center") },
    { v: "right", icon: <AlignRight className="h-4 w-4" />, title: t("prop.align.right") },
    { v: "justify", icon: <AlignJustify className="h-4 w-4" />, title: t("prop.align.justify") },
  ];
  const resolvedValue =
    current === "center" || current === "right" || current === "justify"
      ? current
      : current === "end"
        ? "right"
        : "left";
  // 명시 edit이 없으면(value 없음) 표시되는 highlight는 상속/computed 기본값이므로
  // 활성 탭을 디밍해 "명시 지정"과 구분 — SelectProp의 isDefault 처리와 일관.
  const isDefault = !value;

  return (
    <PropRow label={label} source={source}>
      <Tabs value={resolvedValue} onValueChange={(v) => set(v)}>
        <TabsList
          className={cn(
            "grid w-full grid-cols-4",
            isDefault && "[&_[data-state=active]]:opacity-50",
          )}
        >
          {options.map((o) => (
            <TabsTrigger
              key={o.v}
              value={o.v}
              title={o.title}
              aria-label={o.title}
              onPointerDownCapture={() => {
                preClick.current = { hadEdit: !!value, resolved: resolvedValue };
              }}
              // 명시 edit이 있는 채로 이미 활성인 탭을 다시 누른 경우에만 편집을 지워
              // 상속/computed 기본값으로 되돌린다(비활성 탭 클릭은 onValueChange가 set).
              onClick={() => {
                if (preClick.current.hadEdit && o.v === preClick.current.resolved)
                  set("");
              }}
            >
              {o.icon}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </PropRow>
  );
}

const SIDE_LINES = {
  top: { x1: 2.5, y1: 2.5, x2: 11.5, y2: 2.5 },
  right: { x1: 11.5, y1: 2.5, x2: 11.5, y2: 11.5 },
  bottom: { x1: 2.5, y1: 11.5, x2: 11.5, y2: 11.5 },
  left: { x1: 2.5, y1: 2.5, x2: 2.5, y2: 11.5 },
} as const;

function SideEdgeIcon({
  side,
  className,
}: {
  side: keyof typeof SIDE_LINES;
  className?: string;
}) {
  const l = SIDE_LINES[side];
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="9" height="9" strokeWidth="1" opacity="0.35" />
      <line
        x1={l.x1}
        y1={l.y1}
        x2={l.x2}
        y2={l.y2}
        strokeWidth="2.5"
        strokeLinecap="butt"
      />
    </svg>
  );
}

function borderStyleStroke(style: string): {
  dash?: string;
  round?: boolean;
  faint?: boolean;
} {
  if (style === "dashed") return { dash: "2.5 1.5" };
  if (style === "dotted") return { dash: "0.1 2", round: true };
  if (!style || style === "none") return { faint: true };
  return {};
}

function SideStyleIcon({
  side,
  style,
  className,
}: {
  side: keyof typeof SIDE_LINES;
  style: string;
  className?: string;
}) {
  const l = SIDE_LINES[side];
  const s = borderStyleStroke(style);
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="9" height="9" strokeWidth="1" opacity="0.35" />
      <line
        x1={l.x1}
        y1={l.y1}
        x2={l.x2}
        y2={l.y2}
        strokeWidth="2.5"
        strokeLinecap={s.round ? "round" : "butt"}
        strokeDasharray={s.dash}
        opacity={s.faint ? 0.3 : 1}
      />
    </svg>
  );
}

const BORDER_STYLE_PROPS: [string, string, string, string] = [
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
];

const BORDER_STYLE_OPTIONS = [
  "",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
  "none",
];

function SideStyleSelect({
  prop,
  side,
  sideTitle,
  controlled,
}: {
  prop: string;
  side: keyof typeof SIDE_LINES;
  sideTitle: string;
  controlled?: { value: string; placeholder: string; set: (v: string) => void };
}) {
  const styleProp = useStyleProp(prop);
  const value = controlled?.value ?? styleProp.value;
  const placeholder = controlled?.placeholder ?? styleProp.placeholder;
  const set = controlled?.set ?? styleProp.set;
  const current = (value || placeholder || "").trim();
  const isDefault = !value && isKnownDefault(prop, placeholder);
  const commit = (v: string) => set(v === "__empty__" ? "" : v);
  return (
    <Select value={current} onValueChange={commit}>
      <SelectTrigger
        className={cn(
          "h-9 gap-1 px-1.5 [&>svg:last-child]:hidden",
          isDefault && "text-muted-foreground/50",
        )}
        title={`${sideTitle} · ${current || "none"}`}
        aria-label={sideTitle}
      >
        {controlled ? null : (
          <SideStyleIcon
            side={side}
            style={current}
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left text-xs",
            controlled && !value && !isDefault && "text-muted-foreground",
          )}
        >
          {current || "none"}
        </span>
      </SelectTrigger>
      <SelectContent>
        {BORDER_STYLE_OPTIONS.map((o) => (
          <SelectItem key={o} value={o || "__empty__"}>
            {o || `(${placeholder || "none"})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// linked 단일 select — linked일 때만 마운트돼 merged 셀렉터를 구독한다.
function MergedStyleSelect({
  props,
  set,
  sideTitle,
}: {
  props: string[];
  set: (v: string) => void;
  sideTitle: string;
}) {
  const t = useT();
  const merged = useMergedSides(props);
  return (
    <div className="min-w-0 flex-1">
      <SideStyleSelect
        prop={props[0]}
        side="top"
        sideTitle={sideTitle}
        controlled={{
          value: merged.value,
          placeholder: merged.mixed ? t("prop.mixed") : merged.placeholder,
          set,
        }}
      />
    </div>
  );
}

export function QuadStyleProp({ label }: { label: string }) {
  const t = useT();
  const { linked, toggle, setAllProps } = useLinkedProps(BORDER_STYLE_PROPS);
  const source = useCommonPropSource(BORDER_STYLE_PROPS);

  return (
    <PropRow label={label} source={source}>
      <div className="flex gap-1">
        {linked ? (
          <MergedStyleSelect
            props={BORDER_STYLE_PROPS}
            set={setAllProps}
            sideTitle={t("prop.side.all")}
          />
        ) : (
          <div className="grid flex-1 grid-cols-4 gap-1">
            <SideStyleSelect
              prop={BORDER_STYLE_PROPS[0]}
              side="top"
              sideTitle={t("prop.side.top")}
            />
            <SideStyleSelect
              prop={BORDER_STYLE_PROPS[1]}
              side="right"
              sideTitle={t("prop.side.right")}
            />
            <SideStyleSelect
              prop={BORDER_STYLE_PROPS[2]}
              side="bottom"
              sideTitle={t("prop.side.bottom")}
            />
            <SideStyleSelect
              prop={BORDER_STYLE_PROPS[3]}
              side="left"
              sideTitle={t("prop.side.left")}
            />
          </div>
        )}
        <LinkToggle linked={linked} onToggle={toggle} />
      </div>
    </PropRow>
  );
}

// linked 단일 필드(ValueCombobox) — linked일 때만 마운트돼 merged 셀렉터를 구독한다.
// QuadProp/RadiusProp/GapPairProp 공용(아이콘·iconTitle·testId만 다름).
function MergedSideField({
  props,
  set,
  iconTitle,
  testId,
}: {
  props: string[];
  set: (v: string) => void;
  iconTitle: string;
  testId?: string;
}) {
  const t = useT();
  const merged = useMergedSides(props);
  return (
    <div className="min-w-0 flex-1" data-testid={testId}>
      <ValueCombobox
        prop={props[0]}
        iconTitle={iconTitle}
        controlled={{
          value: merged.value,
          placeholder: merged.mixed ? t("prop.mixed") : merged.placeholder,
          set,
        }}
      />
    </div>
  );
}

export function QuadProp({
  label,
  prefix,
  props: explicitProps,
}: {
  label: string;
  prefix?: string;
  props?: [string, string, string, string];
}) {
  const t = useT();
  const props = useMemo(
    () =>
      explicitProps ?? [
        `${prefix}-top`,
        `${prefix}-right`,
        `${prefix}-bottom`,
        `${prefix}-left`,
      ],
    [explicitProps, prefix],
  );
  const { linked, toggle, setAllProps } = useLinkedProps(props);
  const source = useCommonPropSource(props);

  return (
    <PropRow label={label} source={source}>
      <div className="flex gap-1">
        {linked ? (
          <MergedSideField
            props={props}
            set={setAllProps}
            iconTitle={t("prop.side.all")}
            testId="merged-side-field"
          />
        ) : (
          <div className="grid flex-1 grid-cols-4 gap-1" data-testid="quad-sides">
            <ValueCombobox
              prop={props[0]}
              compact
              icon={<SideEdgeIcon side="top" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.side.top")}
            />
            <ValueCombobox
              prop={props[1]}
              compact
              icon={<SideEdgeIcon side="right" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.side.right")}
            />
            <ValueCombobox
              prop={props[2]}
              compact
              icon={<SideEdgeIcon side="bottom" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.side.bottom")}
            />
            <ValueCombobox
              prop={props[3]}
              compact
              icon={<SideEdgeIcon side="left" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.side.left")}
            />
          </div>
        )}
        <LinkToggle linked={linked} onToggle={toggle} />
      </div>
    </PropRow>
  );
}

const CORNER_PATHS = {
  tl: "M2 12 V5 A3 3 0 0 1 5 2 H12",
  tr: "M2 2 H9 A3 3 0 0 1 12 5 V12",
  br: "M12 2 V9 A3 3 0 0 1 9 12 H2",
  bl: "M12 12 H5 A3 3 0 0 1 2 9 V2",
} as const;

function CornerRadiusIcon({
  corner,
  className,
}: {
  corner: keyof typeof CORNER_PATHS;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={CORNER_PATHS[corner]} />
    </svg>
  );
}

const GAP_PROPS = ["row-gap", "column-gap"];

export function GapPairProp() {
  const t = useT();
  const { linked, toggle, setAllProps } = useLinkedProps(GAP_PROPS);
  const source = useCommonPropSource(GAP_PROPS);

  return (
    <PropRow label="gap" source={source}>
      <div className="flex gap-1">
        {linked ? (
          <MergedSideField
            props={GAP_PROPS}
            set={setAllProps}
            iconTitle={t("prop.axis.all")}
          />
        ) : (
          <div className="grid flex-1 grid-cols-2 gap-1">
            <ValueCombobox
              prop="row-gap"
              compact
              icon={<Rows2 className="h-3.5 w-3.5" />}
              iconTitle={t("prop.gap.row")}
            />
            <ValueCombobox
              prop="column-gap"
              compact
              icon={<Columns2 className="h-3.5 w-3.5" />}
              iconTitle={t("prop.gap.column")}
            />
          </div>
        )}
        <LinkToggle linked={linked} onToggle={toggle} />
      </div>
    </PropRow>
  );
}

const RADIUS_PROPS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
];

export function RadiusProp() {
  const t = useT();
  const { linked, toggle, setAllProps } = useLinkedProps(RADIUS_PROPS);
  const source = useCommonPropSource(RADIUS_PROPS);

  return (
    <PropRow label="radius" source={source}>
      <div className="flex gap-1">
        {linked ? (
          <MergedSideField
            props={RADIUS_PROPS}
            set={setAllProps}
            iconTitle={t("prop.corner.all")}
          />
        ) : (
          <div className="grid flex-1 grid-cols-4 gap-1">
            <ValueCombobox
              prop={RADIUS_PROPS[0]}
              compact
              icon={<CornerRadiusIcon corner="tl" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.corner.topLeft")}
            />
            <ValueCombobox
              prop={RADIUS_PROPS[1]}
              compact
              icon={<CornerRadiusIcon corner="tr" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.corner.topRight")}
            />
            <ValueCombobox
              prop={RADIUS_PROPS[2]}
              compact
              icon={<CornerRadiusIcon corner="br" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.corner.bottomRight")}
            />
            <ValueCombobox
              prop={RADIUS_PROPS[3]}
              compact
              icon={<CornerRadiusIcon corner="bl" className="h-3.5 w-3.5" />}
              iconTitle={t("prop.corner.bottomLeft")}
            />
          </div>
        )}
        <LinkToggle linked={linked} onToggle={toggle} />
      </div>
    </PropRow>
  );
}
