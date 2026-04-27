import { useEffect, useRef, useState } from "react";
import { Crosshair, RotateCcw } from "lucide-react";
import { useT } from "@/i18n";
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
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore, type EditorStyleEdits } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { captureElementSnapshot } from "../capture";
import {
  applyClasses,
  applyText,
  clearPicker,
  resetEdits,
  startPicker,
} from "../picker-control";
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";
import { CancelConfirmDialog } from "../components/CancelConfirmDialog";
import { DomNavButton, DomTreeTitle } from "./DomTreeDialog";
import {
  AlignmentProp,
  BoxShadowProp,
  GapPairProp,
  QuadProp,
  RadiusProp,
  Row2,
  SectionRevertButton,
  SelectProp,
  TextProp,
} from "./styleEditor/StylePropEditors";

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
    "background-image",
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
  transition: [
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
  ],
} as const;

export function SelectedPanel() {
  const t = useT();
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
              <DomTreeTitle tagName={selection.tagName} classList={selection.classList} />
            </div>
            <DomNavButton direction="child" />
            <RepickButton />
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
        <GapPairProp />
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
        <TextProp label="bg-image" prop="background-image" />
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

      <Section
        title="Transition"
        action={<SectionRevertButton props={SECTION_PROPS.transition} />}
        collapsible
        defaultOpen={hasSpecified(SECTION_PROPS.transition)}
      >
        <TextProp label="transition" prop="transition-property" />
        <Row2>
          <TextProp label="duration" prop="transition-duration" />
          <TextProp label="delay" prop="transition-delay" />
        </Row2>
        <TextProp label="easing" prop="transition-timing-function" />
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
                  {t("editor.resetChanges")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("editor.resetChanges")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("editor.resetChanges.body", { count: changeCount })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
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
                    {t("common.reset")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              size="lg"
              onClick={() => void handleNext()}
              disabled={proceeding || !hasChange}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      </PageFooter>
    </PageShell>
  );
}

function RepickButton() {
  const t = useT();
  const tabId = useBoundTabId();
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={t("dom.repick")}
      onClick={() => {
        if (tabId) void startPicker(tabId);
      }}
    >
      <Crosshair />
    </Button>
  );
}

function ClassEditor() {
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  const [inputValue, setInputValue] = useState(() =>
    styleEdits.classList.join(" "),
  );
  // 내가 직전에 store로 커밋한 classList를 기억. 외부(revert 등)에서 갈아엎힌
  // 변경이면 input도 함께 리셋, 사용자 본인의 입력이면 trailing space 보존.
  const lastCommittedRef = useRef<string[]>(styleEdits.classList);

  useEffect(() => {
    const next = styleEdits.classList.join(" ");
    if (next !== lastCommittedRef.current.join(" ")) {
      setInputValue(next);
      lastCommittedRef.current = styleEdits.classList;
    }
  }, [styleEdits.classList]);

  if (!selection) return null;

  const handleChange = (next: string) => {
    setInputValue(next);
    const classList = next.split(/\s+/).filter(Boolean);
    lastCommittedRef.current = classList;
    setStyleEdits({ classList });
    if (tabId) void applyClasses(tabId, classList);
  };

  return (
    <Textarea
      value={inputValue}
      onChange={(e) => handleChange(e.target.value)}
      placeholder=""
      className="min-h-9 resize-none text-sm [field-sizing:content]"
      rows={1}
      spellCheck={false}
    />
  );
}

function TextEditor() {
  const t = useT();
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
      placeholder={t("editor.textPlaceholder")}
      className="min-h-9 resize-none text-sm [field-sizing:content]"
      rows={1}
      spellCheck={false}
    />
  );
}

function TextRevertButton() {
  const t = useT();
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
      title={t("editor.revertText")}
      className="h-7 w-7 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}

function ClassRevertButton() {
  const t = useT();
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
      title={t("editor.revertClass")}
      className="h-7 w-7 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}
