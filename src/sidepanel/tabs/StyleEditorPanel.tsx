import { useEffect, useRef, useState } from "react";
import { Code2, Crosshair, Paintbrush, RotateCcw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor-store";
import {
  useSettingsUiStore,
  type StyleEditorView,
} from "@/store/settings-ui-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useAI } from "@/sidepanel/hooks/useAI";
import { useBufferThenSwitch } from "@/sidepanel/hooks/useBufferThenSwitch";
import { hasStyleChange } from "@/sidepanel/lib/hasStyleChange";
import { sectionDefaultOpen } from "@/sidepanel/lib/sectionDefaultOpen";
import { captureElementSnapshot } from "@/sidepanel/capture";
import {
  applyClasses,
  applyText,
  clearPicker,
  startPicker,
} from "@/sidepanel/picker-control";
import { PageFooter, PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { CancelConfirmDialog } from "@/sidepanel/components/CancelConfirmDialog";
import { DomNavButton, DomTreeTitle } from "./DomTreeDialog";
import {
  AlignmentProp,
  BoxShadowProp,
  GapPairProp,
  QuadProp,
  QuadStyleProp,
  RadiusProp,
  Row2,
  SectionRevertButton,
  SelectProp,
  TextProp,
} from "./styleEditor/StylePropEditors";
import { AiStylingDialog } from "./styleEditor/AiStylingDialog";
import { StyleCssView } from "./styleEditor/StyleCssView";
import { StyleChangesDialog } from "./styleEditor/StyleChangesDialog";
import { elementKey } from "@/lib/element-key";

const SECTION_PROPS = {
  layout: [
    "display",
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
  position: ["position", "top", "right", "bottom", "left", "z-index"],
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
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  border: [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-style",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
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
  const bufferedElements = useEditorStore((s) => s.bufferedElements);
  const setAfterImage = useEditorStore((s) => s.setAfterImage);
  const confirmStyles = useEditorStore((s) => s.confirmStyles);
  const reset = useEditorStore((s) => s.reset);
  const styleEditorView = useSettingsUiStore((s) => s.styleEditorView);
  const setStyleEditorView = useSettingsUiStore((s) => s.setStyleEditorView);
  const tabId = useBoundTabId();
  const { status: aiStatus, providerLabel, createSession } = useAI();
  const [proceeding, setProceeding] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  if (!selection) return null;

  const sectionOpen = (props: readonly string[]) =>
    sectionDefaultOpen(props, selection.specifiedStyles, selection.computedStyles);

  const hasChange = hasStyleChange(selection, styleEdits);
  // 현재 element에 diff가 없어도 버퍼에 담긴 element가 있으면 진행 가능.
  const canProceed = hasChange || bufferedElements.length > 0;

  const handleNext = async () => {
    if (!tabId || proceeding || !canProceed) return;
    setProceeding(true);
    try {
      // 현재 element에 변경이 있을 때만 after 스냅샷 캡처(없으면 버퍼만 들고 진행).
      if (hasChange) {
        const img = await captureElementSnapshot(tabId, {
          frameId: selection?.frameId ?? 0,
        });
        setAfterImage(img);
      } else {
        // 버퍼 승격으로 복원된 afterImage가 diff 0건인 채 저장되는 것 방지.
        setAfterImage(null);
      }
      confirmStyles();
    } finally {
      setProceeding(false);
    }
  };

  const nextDisabled = proceeding || !canProceed;
  const nextButton = (
    <Button
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      aria-disabled={nextDisabled}
      data-testid="next-step"
      onClick={() => {
        if (nextDisabled) return;
        void handleNext();
      }}
    >
      {t("common.next")}
    </Button>
  );

  return (
    <PageShell>
      <PageScroll>
        <div className="sticky top-0 z-10 border-b border-border bg-background py-6">
          <div className="flex items-center gap-2 px-4">
            <DomNavButton direction="parent" />
            <div className="min-w-0 flex-1">
              <DomTreeTitle tagName={selection.tagName} classList={selection.classList} />
            </div>
            <DomNavButton direction="child" />
            <RepickButton />
          </div>
          <Tabs
            value={styleEditorView}
            onValueChange={(v) => setStyleEditorView(v as StyleEditorView)}
            className="mt-6 border-t border-border px-4 pt-3"
          >
            <TabsList className="grid h-9 w-full grid-cols-2" data-testid="style-view-toggle">
              <TabsTrigger value="form" data-testid="style-view-form" className="min-w-0 gap-1.5">
                <Paintbrush className="h-3.5 w-3.5 shrink-0" />
                {t("editor.view.form")}
              </TabsTrigger>
              <TabsTrigger value="code" data-testid="style-view-code" className="min-w-0 gap-1.5">
                <Code2 className="h-3.5 w-3.5 shrink-0" />
                {t("editor.view.code")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className={cn("[&>section:last-child]:border-b", styleEditorView !== "form" && "hidden")}>
          <Section
            title={t("editor.section.class")}
            action={<ClassRevertButton />}
          >
            <ClassEditor />
          </Section>
        </div>

        {styleEditorView === "code" && (
          <div className="border-b border-border">
            <StyleCssView key={elementKey(selection)} />
          </div>
        )}

        <div className={cn("[&>section:last-child]:border-b", styleEditorView !== "form" && "hidden")}>
        <Section
          title={t("editor.section.layout")}
          action={<SectionRevertButton props={SECTION_PROPS.layout} />}
          collapsible
          defaultOpen={sectionOpen(SECTION_PROPS.layout)}
        >
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
        title={t("editor.section.position")}
        action={<SectionRevertButton props={SECTION_PROPS.position} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.position)}
        testId="section-position"
      >
        <Row2>
          <SelectProp
            label="position"
            prop="position"
            options={["", "static", "relative", "absolute", "fixed", "sticky"]}
          />
          <TextProp label="z-index" prop="z-index" />
        </Row2>
        <QuadProp label="inset" props={["top", "right", "bottom", "left"]} />
      </Section>

      <Section
        title={t("editor.section.container")}
        action={<SectionRevertButton props={SECTION_PROPS.container} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.container)}
      >
        <Row2>
          <TextProp label="bg-color" prop="background-color" />
          <TextProp label="opacity" prop="opacity" />
        </Row2>
        <TextProp label="bg-image" prop="background-image" />
        <RadiusProp />
      </Section>

      <Section
        title={t("editor.section.border")}
        action={<SectionRevertButton props={SECTION_PROPS.border} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.border)}
      >
        <QuadProp
          label="border-width"
          props={[
            "border-top-width",
            "border-right-width",
            "border-bottom-width",
            "border-left-width",
          ]}
        />
        <QuadProp
          label="border-color"
          props={[
            "border-top-color",
            "border-right-color",
            "border-bottom-color",
            "border-left-color",
          ]}
        />
        <QuadStyleProp label="border-style" />
      </Section>

      <Section
        title={t("editor.section.size")}
        action={<SectionRevertButton props={SECTION_PROPS.size} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.size)}
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
        title={t("editor.section.overflow")}
        action={<SectionRevertButton props={SECTION_PROPS.overflow} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.overflow)}
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
      </div>

      {selection.text !== null ? (
        <div className={cn("[&>section:last-child]:border-b", styleEditorView !== "form" && "hidden")}>
          <Section
            title={t("editor.section.text")}
            action={<TextRevertButton />}
          >
            <TextEditor />
          </Section>
        </div>
      ) : null}

      <div className={cn(styleEditorView !== "form" && "hidden")}>
      <Section
        title={t("editor.section.typography")}
        action={<SectionRevertButton props={SECTION_PROPS.typography} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.typography)}
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
        title={t("editor.section.effects")}
        action={<SectionRevertButton props={SECTION_PROPS.effects} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.effects)}
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
        title={t("editor.section.transition")}
        action={<SectionRevertButton props={SECTION_PROPS.transition} />}
        collapsible
        defaultOpen={sectionOpen(SECTION_PROPS.transition)}
      >
        <TextProp label="transition-property" prop="transition-property" />
        <Row2>
          <TextProp label="duration" prop="transition-duration" />
          <TextProp label="delay" prop="transition-delay" />
        </Row2>
        <TextProp label="easing" prop="transition-timing-function" />
        </Section>
      </div>
      </PageScroll>
      {aiStatus === "available" && (
        <button
          data-testid="ai-styling-trigger"
          className="flex items-center justify-between rounded-t-lg bg-teal-100/80 px-3.5 py-2.5 text-teal-700 transition-colors hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900"
          onClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setAiDialogOpen(true); }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge variant="outline" className="shrink-0 font-normal border-teal-500 text-teal-600 dark:border-teal-400 dark:text-teal-300">{providerLabel ?? t("ai.badge.chromeAI")}</Badge>
            <span className="truncate bg-gradient-to-r from-teal-600 to-cyan-500 bg-clip-text text-sm text-transparent dark:from-teal-300 dark:to-cyan-300">
              {t("aiStyling.banner")}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-sm font-medium text-transparent dark:from-cyan-300 dark:to-teal-300">
            <Sparkles className="h-4 w-4 fill-current text-teal-500 dark:text-teal-300" />
            {t("aiStyling.generate")}
          </span>
        </button>
      )}
      <AiStylingDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen} createSession={createSession} />
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <CancelConfirmDialog
            onConfirm={() => {
              reset();
              if (tabId) void clearPicker(tabId);
            }}
          />
          <div className="flex items-center gap-2">
            <StyleChangesDialog />
            {!canProceed ? (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>{nextButton}</TooltipTrigger>
                  <TooltipContent className="max-w-60">
                    {t("editor.noChangeHint")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              nextButton
            )}
          </div>
        </div>
      </PageFooter>
    </PageShell>
  );
}

function RepickButton() {
  const t = useT();
  const tabId = useBoundTabId();
  const bufferThenSwitch = useBufferThenSwitch();
  return (
    <Button
      type="button"
      size="icon"
      variant="default"
      className="h-8 w-8 shrink-0"
      title={t("dom.repick")}
      aria-label={t("dom.repick")}
      data-testid="repick"
      onClick={() => {
        if (tabId) void bufferThenSwitch(tabId, () => startPicker(tabId));
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
    const frameId = useEditorStore.getState().selection?.frameId ?? 0;
    if (tabId) void applyClasses(tabId, frameId, classList);
  };

  return (
    <Textarea
      value={inputValue}
      onChange={(e) => handleChange(e.target.value)}
      placeholder=""
      className="min-h-9 resize-none text-sm [field-sizing:content]"
      rows={1}
      spellCheck={false}
      data-testid="class-editor"
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
    const frameId = useEditorStore.getState().selection?.frameId ?? 0;
    if (tabId) void applyText(tabId, frameId, next);
  };

  return (
    <Textarea
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={t("editor.textPlaceholder")}
      className="min-h-9 resize-none text-sm [field-sizing:content]"
      rows={1}
      spellCheck={false}
      data-testid="text-editor"
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
    if (tabId) void applyText(tabId, selection.frameId ?? 0, original);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={handleRevert}
      disabled={!dirty}
      title={t("editor.revertText")}
      aria-label={t("editor.revertText")}
      className="h-8 w-8 shrink-0"
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
    if (tabId) void applyClasses(tabId, selection.frameId ?? 0, classList);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={handleRevert}
      disabled={!dirty}
      title={t("editor.revertClass")}
      aria-label={t("editor.revertClass")}
      className="h-8 w-8 shrink-0"
    >
      <RotateCcw />
    </Button>
  );
}
