import { useCallback, useMemo, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Link,
  PenLine,
  RotateCcw,
  Unlink,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useEditorStore, type EditorStyleEdits } from "@/store/editor-store";
import type { Token, TokenCategory } from "@/types/picker";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { captureElementSnapshot } from "../capture";
import {
  applyClasses,
  applyStyles,
  applyText,
  clearPicker,
  resetEdits,
} from "../picker-control";
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";
import { CancelConfirmDialog } from "../components/CancelConfirmDialog";
import { DomNavButton, DomTreeTitle } from "./DomTreeDialog";

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

const SECTION_PROPS = {
  layout: [
    "display",
    "position",
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "row-gap",
    "column-gap",
  ],
  size: ["width", "height", "min-width", "max-width", "min-height", "max-height"],
  overflow: ["overflow", "overflow-x", "overflow-y", "white-space", "text-overflow"],
  typography: [
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "color",
  ],
  container: [
    "background-color",
    "opacity",
    "border",
    "border-color",
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  effects: ["box-shadow", "filter", "backdrop-filter", "mix-blend-mode"],
} as const;

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

export function SelectedPanel() {
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const setAfterImage = useEditorStore((s) => s.setAfterImage);
  const confirmStyles = useEditorStore((s) => s.confirmStyles);
  const reset = useEditorStore((s) => s.reset);
  const tabId = useBoundTabId();
  const [proceeding, setProceeding] = useState(false);
  if (!selection) return null;

  const hasSpecified = (props: readonly string[]) =>
    props.some((p) => p in selection.specifiedStyles);

  const inlineCount = Object.keys(styleEdits.inlineStyle).length;
  const classDirty =
    selection.classList.length !== styleEdits.classList.length ||
    selection.classList.some((c, i) => c !== styleEdits.classList[i]);
  const textDirty =
    selection.text !== null && styleEdits.text !== selection.text;
  const changeCount =
    inlineCount + (classDirty ? 1 : 0) + (textDirty ? 1 : 0);
  const hasChange = changeCount > 0;

  const handleNext = async () => {
    if (!tabId || proceeding) return;
    setProceeding(true);
    try {
      const img = await captureElementSnapshot(tabId);
      setAfterImage(img);
      confirmStyles();
    } finally {
      setProceeding(false);
    }
  };

  return (
    <PageShell>
      <PageScroll>
        <div className="sticky top-0 z-10 border-b border-border bg-background py-6">
          <div className="flex items-center gap-1 px-4">
            <DomNavButton direction="parent" />
            <div className="min-w-0 flex-1">
              <DomTreeTitle selector={selection.selector} />
            </div>
            <DomNavButton direction="child" />
          </div>
        </div>

        <Section title="Class" action={<ClassRevertButton />}>
          <ClassEditor />
        </Section>

        <Section
          title="Layout"
          action={<SectionRevertButton props={SECTION_PROPS.layout} />}
          collapsible
          defaultOpen={hasSpecified(SECTION_PROPS.layout)}
        >
        <Row2>
          <SelectProp
            label="display"
            prop="display"
            options={[
              "",
              "block",
              "inline",
              "inline-block",
              "flex",
              "inline-flex",
              "grid",
              "inline-grid",
              "none",
            ]}
          />
          <SelectProp
            label="position"
            prop="position"
            options={["", "static", "relative", "absolute", "fixed", "sticky"]}
          />
        </Row2>
        <Row2>
          <SelectProp
            label="flex-direction"
            prop="flex-direction"
            options={["", "row", "column", "row-reverse", "column-reverse"]}
          />
          <SelectProp
            label="flex-wrap"
            prop="flex-wrap"
            options={["", "nowrap", "wrap", "wrap-reverse"]}
          />
        </Row2>
        <Row2>
          <SelectProp
            label="justify-content"
            prop="justify-content"
            options={[
              "",
              "flex-start",
              "flex-end",
              "center",
              "space-between",
              "space-around",
              "space-evenly",
            ]}
          />
          <SelectProp
            label="align-items"
            prop="align-items"
            options={["", "flex-start", "flex-end", "center", "stretch", "baseline"]}
          />
        </Row2>
        <QuadProp label="margin" prefix="margin" />
        <QuadProp label="padding" prefix="padding" />
        <Row2>
          <TextProp label="row-gap" prop="row-gap" />
          <TextProp label="column-gap" prop="column-gap" />
        </Row2>
      </Section>

      <Section
        title="Container"
        action={<SectionRevertButton props={SECTION_PROPS.container} />}
        collapsible
        defaultOpen={hasSpecified(SECTION_PROPS.container)}
      >
        <Row2>
          <TextProp label="bg-color" prop="background-color" />
          <TextProp label="opacity" prop="opacity" />
        </Row2>
        <Row2>
          <TextProp label="border" prop="border" />
          <TextProp label="border-color" prop="border-color" />
        </Row2>
        <RadiusProp />
      </Section>

      <Section
        title="Size"
        action={<SectionRevertButton props={SECTION_PROPS.size} />}
        collapsible
        defaultOpen={hasSpecified(SECTION_PROPS.size)}
      >
        <Row2>
          <TextProp label="width" prop="width" />
          <TextProp label="height" prop="height" />
        </Row2>
        <Row2>
          <TextProp label="min-width" prop="min-width" />
          <TextProp label="max-width" prop="max-width" />
        </Row2>
        <Row2>
          <TextProp label="min-height" prop="min-height" />
          <TextProp label="max-height" prop="max-height" />
        </Row2>
      </Section>

      <Section
        title="Overflow"
        action={<SectionRevertButton props={SECTION_PROPS.overflow} />}
        collapsible
        defaultOpen={hasSpecified(SECTION_PROPS.overflow)}
      >
        <SelectProp
          label="overflow"
          prop="overflow"
          options={["", "visible", "hidden", "scroll", "auto", "clip"]}
        />
        <Row2>
          <SelectProp
            label="overflow-x"
            prop="overflow-x"
            options={["", "visible", "hidden", "scroll", "auto", "clip"]}
          />
          <SelectProp
            label="overflow-y"
            prop="overflow-y"
            options={["", "visible", "hidden", "scroll", "auto", "clip"]}
          />
        </Row2>
        <Row2>
          <SelectProp
            label="white-space"
            prop="white-space"
            options={[
              "",
              "normal",
              "nowrap",
              "pre",
              "pre-wrap",
              "pre-line",
              "break-spaces",
            ]}
          />
          <SelectProp
            label="text-overflow"
            prop="text-overflow"
            options={["", "clip", "ellipsis"]}
          />
        </Row2>
      </Section>

      {selection.text !== null ? (
        <Section title="Text" action={<TextRevertButton />}>
          <TextEditor />
        </Section>
      ) : null}

      <Section
        title="Typography"
        action={<SectionRevertButton props={SECTION_PROPS.typography} />}
        collapsible
        defaultOpen={hasSpecified(SECTION_PROPS.typography)}
      >
        <Row2>
          <TextProp label="font-size" prop="font-size" />
          <TextProp label="font-weight" prop="font-weight" />
        </Row2>
        <Row2>
          <TextProp label="line-height" prop="line-height" />
          <TextProp label="letter-spacing" prop="letter-spacing" />
        </Row2>
        <Row2>
          <AlignmentProp label="text-align" prop="text-align" />
          <TextProp label="color" prop="color" />
        </Row2>
      </Section>


      <Section
        title="Effects"
        action={<SectionRevertButton props={SECTION_PROPS.effects} />}
        collapsible
        defaultOpen={hasSpecified(SECTION_PROPS.effects)}
      >
        <BoxShadowProp />
        <TextProp label="filter" prop="filter" />
        <TextProp label="backdrop-filter" prop="backdrop-filter" />
        <SelectProp
          label="mix-blend-mode"
          prop="mix-blend-mode"
          options={[
            "",
            "normal",
            "multiply",
            "screen",
            "overlay",
            "darken",
            "lighten",
            "color-dodge",
            "color-burn",
            "difference",
            "exclusion",
            "hue",
            "saturation",
            "color",
            "luminosity",
          ]}
        />
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <CancelConfirmDialog
            onConfirm={() => {
              reset();
              if (tabId) void clearPicker(tabId);
            }}
          />
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={!hasChange}
                >
                  변경사항 초기화
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>변경사항 초기화</AlertDialogTitle>
                  <AlertDialogDescription>
                    {changeCount}건의 변경사항을 초기화하시겠습니까? 모든 스타일이 원래 값으로 돌아갑니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>닫기</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      const initial: EditorStyleEdits = {
                        classList: [...selection.classList],
                        inlineStyle: {},
                        text: selection.text ?? "",
                      };
                      useEditorStore.getState().setStyleEdits(initial);
                      if (tabId) void resetEdits(tabId);
                    }}
                  >
                    초기화
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              size="lg"
              onClick={() => void handleNext()}
              disabled={proceeding || !hasChange}
            >
              다음
            </Button>
          </div>
        </div>
      </PageFooter>
    </PageShell>
  );
}

function ClassEditor() {
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  const value = useMemo(
    () => styleEdits.classList.join(" "),
    [styleEdits.classList],
  );

  if (!selection) return null;

  const handleChange = (next: string) => {
    const classList = next.split(/\s+/).filter(Boolean);
    setStyleEdits({ classList });
    if (tabId) void applyClasses(tabId, classList);
  };

  return (
    <Textarea
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      placeholder=""
      className="min-h-9 resize-none text-sm [field-sizing:content]"
      rows={1}
      spellCheck={false}
    />
  );
}

function SectionRevertButton({ props }: { props: readonly string[] }) {
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
      title="이 섹션 인라인 원복"
      className="h-7 w-7 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}

function TextEditor() {
  const selection = useEditorStore((s) => s.selection);
  const value = useEditorStore((s) => s.styleEdits.text);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  if (!selection || selection.text === null) return null;

  const handleChange = (next: string) => {
    setStyleEdits({ text: next });
    if (tabId) void applyText(tabId, next);
  };

  return (
    <Textarea
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="요소 텍스트"
      className="min-h-9 resize-none text-sm [field-sizing:content]"
      rows={1}
      spellCheck={false}
    />
  );
}

function TextRevertButton() {
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  if (!selection || selection.text === null) return null;

  const dirty = styleEdits.text !== selection.text;

  const handleRevert = () => {
    const original = selection.text ?? "";
    setStyleEdits({ text: original });
    if (tabId) void applyText(tabId, original);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={handleRevert}
      disabled={!dirty}
      title="원본 텍스트로 되돌리기"
      className="h-7 w-7 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}

function ClassRevertButton() {
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  if (!selection) return null;

  const original = selection.classList;
  const current = styleEdits.classList;
  const dirty =
    original.length !== current.length ||
    original.some((v, i) => v !== current[i]);

  const handleRevert = () => {
    const classList = [...original];
    setStyleEdits({ classList });
    if (tabId) void applyClasses(tabId, classList);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={handleRevert}
      disabled={!dirty}
      title="원본 class로 되돌리기"
      className="h-7 w-7 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
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
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors",
        linked ? "border-foreground bg-foreground text-background hover:bg-foreground/80" : "hover:bg-muted",
      )}
      title={linked ? "개별 편집" : "일괄 편집"}
    >
      {linked ? (
        <Link className="h-3.5 w-3.5" />
      ) : (
        <Unlink className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function useStyleProp(prop: string) {
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

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function TextProp({ label, prop }: { label: string; prop: string }) {
  return (
    <PropRow label={label}>
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
  return parts;
}

function BoxShadowProp() {
  const { value, placeholder, set } = useStyleProp("box-shadow");

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
    <PropRow label="box-shadow">
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

function SelectProp({
  label,
  prop,
  options,
}: {
  label: string;
  prop: string;
  options: string[];
}) {
  const { value, placeholder, set } = useStyleProp(prop);
  const isDefault = !value && isKnownDefault(prop, placeholder);
  return (
    <PropRow label={label}>
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

function AlignmentProp({ label, prop }: { label: string; prop: string }) {
  const { value, placeholder, set } = useStyleProp(prop);
  const current = (value || placeholder || "").trim();
  const options: { v: string; icon: React.ReactNode; title: string }[] = [
    { v: "left", icon: <AlignLeft className="h-4 w-4" />, title: "왼쪽" },
    { v: "center", icon: <AlignCenter className="h-4 w-4" />, title: "가운데" },
    { v: "right", icon: <AlignRight className="h-4 w-4" />, title: "오른쪽" },
    { v: "justify", icon: <AlignJustify className="h-4 w-4" />, title: "양쪽" },
  ];
  const resolvedValue =
    current === "start" || current === "" ? "left" : current;

  return (
    <PropRow label={label}>
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

function QuadProp({ label, prefix }: { label: string; prefix: string }) {
  const props = useMemo(
    () => [`${prefix}-top`, `${prefix}-right`, `${prefix}-bottom`, `${prefix}-left`],
    [prefix],
  );
  const { linked, toggle, setAllProps } = useLinkedProps(props);

  return (
    <PropRow label={label}>
      <div className="flex gap-1">
        <div className="grid flex-1 grid-cols-4 gap-1">
          <ValueCombobox
            prop={props[0]}
            compact
            icon={<SideEdgeIcon side="top" className="h-3.5 w-3.5" />}
            iconTitle="위"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={props[1]}
            compact
            icon={<SideEdgeIcon side="right" className="h-3.5 w-3.5" />}
            iconTitle="오른쪽"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={props[2]}
            compact
            icon={<SideEdgeIcon side="bottom" className="h-3.5 w-3.5" />}
            iconTitle="아래"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={props[3]}
            compact
            icon={<SideEdgeIcon side="left" className="h-3.5 w-3.5" />}
            iconTitle="왼쪽"
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

const RADIUS_PROPS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
];

function RadiusProp() {
  const { linked, toggle, setAllProps } = useLinkedProps(RADIUS_PROPS);

  return (
    <PropRow label="radius">
      <div className="flex gap-1">
        <div className="grid flex-1 grid-cols-4 gap-1">
          <ValueCombobox
            prop={RADIUS_PROPS[0]}
            compact
            icon={<CornerRadiusIcon corner="tl" className="h-3.5 w-3.5" />}
            iconTitle="좌상단"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={RADIUS_PROPS[1]}
            compact
            icon={<CornerRadiusIcon corner="tr" className="h-3.5 w-3.5" />}
            iconTitle="우상단"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={RADIUS_PROPS[2]}
            compact
            icon={<CornerRadiusIcon corner="br" className="h-3.5 w-3.5" />}
            iconTitle="우하단"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
          <ValueCombobox
            prop={RADIUS_PROPS[3]}
            compact
            icon={<CornerRadiusIcon corner="bl" className="h-3.5 w-3.5" />}
            iconTitle="좌하단"
            onLinkedCommit={linked ? setAllProps : undefined}
          />
        </div>
        <LinkToggle linked={linked} onToggle={toggle} />
      </div>
    </PropRow>
  );
}

function ValueCombobox({
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

function isKnownDefault(prop: string, computed: string): boolean {
  const value = computed.trim();
  if (prop === "border" && /^0px\s+none\b/.test(value)) return true;
  const defaults = KNOWN_DEFAULTS[prop];
  if (!defaults) return false;
  return defaults.includes(value);
}
