import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  CornerLeftUp,
  CornerRightDown,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Link,
  List,
  MousePointerClick,
  RotateCcw,
  Unlink,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor-store";
import type { Token, TokenCategory, TreeNode } from "@/types/picker";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { captureElementSnapshot } from "../capture";
import {
  applyClasses,
  applyStyles,
  applyText,
  clearPicker,
  describeChildren,
  describeInitialTree,
  navigatePicker,
  previewClear,
  previewHover,
  resetEdits,
  selectByPath,
  startPicker,
  stopPicker,
} from "../picker-control";
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";
import { useTabNav } from "../App";
import { DraftingPanel } from "./DraftingPanel";
import { PreviewPanel } from "./PreviewPanel";

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

export function IssueTab() {
  const tabId = useBoundTabId();
  const phase = useEditorStore((s) => s.phase);
  const selection = useEditorStore((s) => s.selection);

  useEffect(() => {
    if (!tabId) return;
    if (useEditorStore.getState().phase === "idle") {
      void startPicker(tabId);
    }
    return () => {
      if (useEditorStore.getState().phase === "picking") {
        void stopPicker(tabId);
      }
    };
  }, [tabId]);

  if (!tabId) {
    return <UnsupportedPage />;
  }

  if (phase === "picking") {
    return <PickingState onCancel={() => void stopPicker(tabId)} />;
  }

  if (phase === "idle" || !selection) {
    return <EmptyState onStart={() => void startPicker(tabId)} />;
  }

  if (phase === "drafting") {
    return <DraftingPanel />;
  }

  if (phase === "done") {
    return <SubmitSuccessView />;
  }

  if (phase === "previewing") {
    return <PreviewPanel />;
  }

  return <SelectedPanel />;
}

function UnsupportedPage() {
  return (
    <PageShell>
      <EmptyShell
        icon={<Crosshair className="h-6 w-6 text-muted-foreground" />}
        title="지원하지 않는 페이지"
      />
    </PageShell>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <PageShell>
      <EmptyShell
        icon={<MousePointerClick className="h-6 w-6 text-muted-foreground" />}
        title="선택된 요소가 없습니다"
        action={
          <Button onClick={onStart}>
            <Crosshair />
            요소 선택 시작
          </Button>
        }
      />
    </PageShell>
  );
}

function PickingState({ onCancel }: { onCancel: () => void }) {
  return (
    <PageShell>
      <EmptyShell
        icon={<Crosshair className="h-6 w-6 text-muted-foreground" />}
        title="요소를 선택하세요"
        action={
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
        }
      />
    </PageShell>
  );
}

function SelectedPanel() {
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
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

  const handleResetAll = () => {
    const originalClass = [...selection.classList];
    const originalText = selection.text ?? "";
    setStyleEdits({
      inlineStyle: {},
      classList: originalClass,
      text: originalText,
    });
    if (tabId) {
      void resetEdits(tabId);
      if (classDirty) void applyClasses(tabId, originalClass);
      if (textDirty) void applyText(tabId, originalText);
    }
  };

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
        <Section>
          <div className="flex items-center gap-1">
            <DomNavButton direction="parent" />
            <div className="min-w-0 flex-1">
              <DomTreeTitle selector={selection.selector} />
            </div>
            <DomNavButton direction="child" />
          </div>
        </Section>

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
        <Row2>
          <TextProp label="box-shadow" prop="box-shadow" />
          <TextProp label="filter" prop="filter" />
        </Row2>
        <Row2>
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
        </Row2>
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            변경사항 {changeCount}개 적용 중
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleResetAll}
            disabled={!hasChange}
          >
            <RotateCcw />
            모두 초기화
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xl"
            variant="outline"
            className="flex-1"
            onClick={() => {
              reset();
              if (tabId) {
                void clearPicker(tabId);
                void startPicker(tabId);
              }
            }}
          >
            다시 선택
          </Button>
          <Button
            size="xl"
            className="flex-1"
            onClick={() => void handleNext()}
            disabled={proceeding || !hasChange}
          >
            다음
          </Button>
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
      placeholder="공백 구분 class"
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
}: {
  prop: string;
  compact?: boolean;
  icon?: React.ReactNode;
  iconTitle?: string;
  onLinkedCommit?: (value: string) => void;
}) {
  const { value, placeholder, set } = useStyleProp(prop);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showAll, setShowAll] = useState(false);
  const tokens = useEditorStore((s) => s.tokens);
  const category = PROP_CATEGORY[prop];

  const tokenNames = extractAllTokenNames(value);
  const placeholderTokenNames = !value ? extractAllTokenNames(placeholder) : [];
  const isDefault = !value && isKnownDefault(prop, placeholder);
  const activeTokenNames = tokenNames.length > 0 ? tokenNames : placeholderTokenNames;
  const familyPrefixes = useMemo(() => {
    const prefixes: string[] = [];
    for (const n of activeTokenNames) {
      const p = tokenFamilyPrefix(n, tokens);
      if (p && !prefixes.includes(p)) prefixes.push(p);
    }
    return prefixes;
  }, [activeTokenNames, tokens]);

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

  const isMulti = activeTokenNames.length > 1;

  const commit = (next: string) => {
    if (onLinkedCommit) onLinkedCommit(next);
    else set(next);
    setOpen(false);
  };

  const toggle = (tokenName: string) => {
    const current = extractAllTokenNames(value);
    const idx = current.indexOf(tokenName);
    let next: string[];
    if (idx >= 0) {
      next = current.filter((_, i) => i !== idx);
    } else {
      next = [...current, tokenName];
    }
    if (next.length === 0) {
      if (onLinkedCommit) onLinkedCommit("");
      else set("");
    } else {
      const val = next.map((n) => `var(${n})`).join(", ");
      if (onLinkedCommit) onLinkedCommit(val);
      else set(val);
    }
  };

  const onTokenSelect = isMulti
    ? (tokenVarExpr: string) => {
        const m = /^var\(\s*(--[^\s,)]+)/.exec(tokenVarExpr);
        if (m) toggle(m[1]);
      }
    : commit;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraft(tokenNames.length > 0 ? "" : value);
      setShowAll(false);
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
            placeholder="값 또는 토큰 검색"
            value={draft}
            onValueChange={(v) => {
              setDraft(v);
              if (onLinkedCommit) onLinkedCommit(v.trim());
              else set(v.trim());
            }}
            className="h-9"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !(e.nativeEvent as unknown as { isComposing: boolean })
                  .isComposing
              ) {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <CommandList>
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
            {value ? (
              <CommandGroup heading="동작">
                <CommandItem value="__clear__" onSelect={() => commit("")}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="text-xs">값 지우기</span>
                </CommandItem>
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

function DomNavButton({ direction }: { direction: "parent" | "child" }) {
  const tabId = useBoundTabId();
  const canNavigate = useEditorStore((s) =>
    direction === "parent"
      ? (s.selection?.hasParent ?? false)
      : (s.selection?.hasChild ?? false),
  );
  const Icon = direction === "parent" ? CornerLeftUp : CornerRightDown;
  const label = direction === "parent" ? "부모 요소" : "첫 자식 요소";
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={label}
      disabled={!canNavigate}
      onClick={() => {
        if (tabId) void navigatePicker(tabId, direction);
      }}
    >
      <Icon />
    </Button>
  );
}

function DomTreeTitle({ selector }: { selector: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block w-full truncate text-center text-2xl font-semibold outline-none hover:opacity-70 focus-visible:ring-1 focus-visible:ring-ring"
          title={selector}
        >
          {selector}
        </button>
      </DialogTrigger>
      <DialogContent className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">DOM 선택</DialogTitle>
        </DialogHeader>
        <DomTree onPicked={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function injectChildren(
  tree: TreeNode,
  selector: string,
  children: TreeNode[],
): TreeNode {
  if (tree.selector === selector) return { ...tree, children };
  if (!tree.children) return tree;
  return {
    ...tree,
    children: tree.children.map((c) => injectChildren(c, selector, children)),
  };
}

function DomTree({ onPicked }: { onPicked: () => void }) {
  const tabId = useBoundTabId();
  const currentSelector = useEditorStore((s) => s.selection?.selector);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tabId) return;
    let cancelled = false;
    setLoading(true);
    void describeInitialTree(tabId).then((resp) => {
      if (cancelled || !resp) {
        setLoading(false);
        return;
      }
      setTree(resp.tree);
      setExpanded(new Set(resp.ancestorPath));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tabId]);

  useEffect(() => {
    return () => {
      if (tabId) void previewClear(tabId);
    };
  }, [tabId]);

  const handleHover = (selector: string | null) => {
    if (!tabId) return;
    if (selector) void previewHover(tabId, selector);
    else void previewClear(tabId);
  };

  const handleSelect = (selector: string) => {
    if (!tabId) return;
    void previewClear(tabId);
    void selectByPath(tabId, selector);
    onPicked();
  };

  const handleToggle = (node: TreeNode) => {
    const willOpen = !expanded.has(node.selector);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.selector)) next.delete(node.selector);
      else next.add(node.selector);
      return next;
    });
    if (
      willOpen &&
      node.children === undefined &&
      node.childCount > 0 &&
      tabId
    ) {
      void describeChildren(tabId, node.selector).then((resp) => {
        setTree((prev) => {
          if (!prev) return prev;
          return injectChildren(prev, node.selector, resp.children);
        });
      });
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        DOM 트리를 불러오는 중...
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        DOM 트리를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <Card className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background py-2 text-[13px]">
      <DomTreeNode
        node={tree}
        depth={0}
        currentSelector={currentSelector}
        expanded={expanded}
        onHover={handleHover}
        onSelect={handleSelect}
        onToggle={handleToggle}
      />
    </Card>
  );
}

function DomTreeNode({
  node,
  depth,
  currentSelector,
  expanded,
  onHover,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  currentSelector?: string;
  expanded: Set<string>;
  onHover: (selector: string | null) => void;
  onSelect: (selector: string) => void;
  onToggle: (node: TreeNode) => void;
}) {
  const isOpen = expanded.has(node.selector);
  const kids = node.children;
  const isCurrent = node.selector === currentSelector;
  const indent = depth * 12 + 4;

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1 py-0.5 pr-2 hover:bg-muted",
          isCurrent && "bg-primary/10",
        )}
        style={{ paddingLeft: `${indent}px` }}
        onMouseEnter={() => onHover(node.selector)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onSelect(node.selector)}
      >
        {node.childCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onToggle(node);
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/15"
            aria-label={isOpen ? "접기" : "펼치기"}
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">&lt;</span>
          <span className="text-sky-600">{node.tag}</span>
          {node.id ? (
            <span className="text-fuchsia-600">#{node.id}</span>
          ) : null}
          {node.classes.slice(0, 3).map((c) => (
            <span key={c} className="text-amber-600">
              .{c}
            </span>
          ))}
          {node.classes.length > 3 ? (
            <span className="text-muted-foreground">
              +{node.classes.length - 3}
            </span>
          ) : null}
          <span className="text-muted-foreground">&gt;</span>
          {node.childCount > 0 && !isOpen ? (
            <span className="ml-1 text-muted-foreground">
              ({node.childCount})
            </span>
          ) : null}
        </span>
      </div>
      {isOpen && kids
        ? kids.map((c) => (
            <DomTreeNode
              key={c.selector}
              node={c}
              depth={depth + 1}
              currentSelector={currentSelector}
              expanded={expanded}
              onHover={onHover}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}

function SubmitSuccessView() {
  const submitResult = useEditorStore((s) => s.submitResult);
  const reset = useEditorStore((s) => s.reset);
  const tabId = useBoundTabId();
  const setTab = useTabNav();

  if (!submitResult) return null;

  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <CircleCheck className="h-6 w-6 text-green-600" />
        </div>
        <h3 className="text-[18px] font-semibold">이슈가 제출되었습니다</h3>
        <a
          href={submitResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {submitResult.key}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setTab("issue-list");
            }}
          >
            <List className="h-4 w-4" />
            이슈 목록
          </Button>
          <Button
            onClick={() => {
              reset();
              if (tabId) void startPicker(tabId);
            }}
          >
            확인
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

function EmptyShell({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">{icon}</div>
      <h3 className="text-[18px] font-semibold">{title}</h3>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
