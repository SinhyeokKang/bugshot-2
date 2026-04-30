import { useCallback, useMemo, useState } from "react";
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
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../../hooks/useBoundTabId";
import { applyStyles } from "../../picker-control";
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
    if (tabId) void applyStyles(tabId, next);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={handleRevert}
      disabled={!dirty}
      title={t("editor.revertSection")}
      className="h-8 w-8 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}

export function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function useLinkedProps(props: string[]) {
  const selection = useEditorStore((s) => s.selection);
  const inlineStyle = useEditorStore((s) => s.styleEdits.inlineStyle);
  const [linked, setLinked] = useState(() => {
    const vals = props.map((p) => {
      if (inlineStyle[p]) return inlineStyle[p];
      if (selection?.specifiedStyles[p]) return selection.specifiedStyles[p];
      if (selection?.computedStyles[p]) return selection.computedStyles[p];
      return "";
    });
    return vals.length > 0 && vals.every((v) => v === vals[0] && v !== "");
  });
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
      if (tabId) void applyStyles(tabId, nextInline);
    },
    [props, tabId],
  );

  return { linked, toggle: () => setLinked((v) => !v), setAllProps };
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
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors",
        linked ? "border-foreground bg-foreground text-background hover:bg-foreground/80" : "hover:bg-muted",
      )}
      title={linked ? t("prop.editIndividual") : t("prop.editTogether")}
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
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-xs text-muted-foreground"
        title={source ? `source: ${source}` : undefined}
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
  const count = Math.max(placeholderParts.length, 1);

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
      <Select value={value} onValueChange={set}>
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
        </SelectContent>
      </Select>
    </PropRow>
  );
}

export function AlignmentProp({ label, prop }: { label: string; prop: string }) {
  const t = useT();
  const { value, placeholder, set } = useStyleProp(prop);
  const source = usePropSource(prop);
  const current = (value || placeholder || "").trim();
  const options: { v: string; icon: React.ReactNode; title: string }[] = [
    { v: "left", icon: <AlignLeft className="h-4 w-4" />, title: t("prop.align.left") },
    { v: "center", icon: <AlignCenter className="h-4 w-4" />, title: t("prop.align.center") },
    { v: "right", icon: <AlignRight className="h-4 w-4" />, title: t("prop.align.right") },
    { v: "justify", icon: <AlignJustify className="h-4 w-4" />, title: t("prop.align.justify") },
  ];
  const resolvedValue =
    current === "start" || current === "" ? "left" : current;

  return (
    <PropRow label={label} source={source}>
      <Tabs
        value={resolvedValue}
        onValueChange={(v) => set(v === resolvedValue && value ? "" : v)}
      >
        <TabsList className="grid w-full grid-cols-4">
          {options.map((o) => (
            <TabsTrigger key={o.v} value={o.v} title={o.title}>
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

export function QuadProp({ label, prefix }: { label: string; prefix: string }) {
  const t = useT();
  const props = useMemo(
    () => [`${prefix}-top`, `${prefix}-right`, `${prefix}-bottom`, `${prefix}-left`],
    [prefix],
  );
  const { linked, toggle, setAllProps } = useLinkedProps(props);
  const source = useCommonPropSource(props);

  return (
    <PropRow label={label} source={source}>
      <div className="flex gap-1">
        <div className="grid flex-1 grid-cols-4 gap-1">
          <ValueCombobox
            prop={props[0]}
            compact
            icon={<SideEdgeIcon side="top" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.side.top")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={props[1]}
            compact
            icon={<SideEdgeIcon side="right" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.side.right")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={props[2]}
            compact
            icon={<SideEdgeIcon side="bottom" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.side.bottom")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={props[3]}
            compact
            icon={<SideEdgeIcon side="left" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.side.left")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
        </div>
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
        <div className="grid flex-1 grid-cols-2 gap-1">
          <ValueCombobox
            prop="row-gap"
            compact
            icon={<Rows2 className="h-3.5 w-3.5" />}
            iconTitle={t("prop.gap.row")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop="column-gap"
            compact
            icon={<Columns2 className="h-3.5 w-3.5" />}
            iconTitle={t("prop.gap.column")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
        </div>
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
        <div className="grid flex-1 grid-cols-4 gap-1">
          <ValueCombobox
            prop={RADIUS_PROPS[0]}
            compact
            icon={<CornerRadiusIcon corner="tl" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.corner.topLeft")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={RADIUS_PROPS[1]}
            compact
            icon={<CornerRadiusIcon corner="tr" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.corner.topRight")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={RADIUS_PROPS[2]}
            compact
            icon={<CornerRadiusIcon corner="br" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.corner.bottomRight")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={RADIUS_PROPS[3]}
            compact
            icon={<CornerRadiusIcon corner="bl" className="h-3.5 w-3.5" />}
            iconTitle={t("prop.corner.bottomLeft")}
            onLinkedCommit={linked ? setAllProps : undefined}
          />
        </div>
        <LinkToggle linked={linked} onToggle={toggle} />
      </div>
    </PropRow>
  );
}
