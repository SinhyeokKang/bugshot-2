import type { ReactNode } from "react";
import {
  Check,
  Circle,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOLS,
  THICKNESS_KEYS,
  TEXT_SIZE_KEYS,
  isStrokeTool,
  type AnnotationTool,
  type AnnotationToolMeta,
  type TextSizeKey,
  type ThicknessKey,
} from "./presets";

const TOOL_ICONS: Record<AnnotationTool, LucideIcon> = {
  select: MousePointer2,
  arrow: MoveUpRight,
  rect: Square,
  ellipse: Circle,
  pen: Pencil,
  text: Type,
  highlight: Highlighter,
};

const COLOR_LABEL_KEYS: TranslationKey[] = [
  "annotation.color.red",
  "annotation.color.yellow",
  "annotation.color.green",
  "annotation.color.blue",
  "annotation.color.black",
];

const THICKNESS_LABEL_KEYS: Record<ThicknessKey, TranslationKey> = {
  S: "annotation.thickness.S",
  M: "annotation.thickness.M",
  L: "annotation.thickness.L",
};

const THICKNESS_STROKE: Record<ThicknessKey, number> = { S: 1.5, M: 3.5, L: 6 };

const TEXTSIZE_LABEL_KEYS: Record<TextSizeKey, TranslationKey> = {
  S: "annotation.textSize.S",
  M: "annotation.textSize.M",
  L: "annotation.textSize.L",
};

// 버튼 안 "A" 글자의 시각 크기(32px 버튼 기준 — 실제 폰트 px와 별개).
const TEXTSIZE_ICON: Record<TextSizeKey, number> = { S: 11, M: 15, L: 20 };

interface AnnotationToolbarProps {
  tool: AnnotationTool | null;
  onToolChange: (tool: AnnotationTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  thickness: ThicknessKey;
  onThicknessChange: (key: ThicknessKey) => void;
  textSize: TextSizeKey;
  onTextSizeChange: (key: TextSizeKey) => void;
  hasSelection: boolean;
  // 선택된 도형이 stroke 계열인지 — select 모드 두께 활성 판정
  selectionIsStroke: boolean;
  // 선택된 도형이 text인지 — select 모드에서 두께 대신 크기 노출 판정
  selectionIsText: boolean;
  onDelete: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onDone: () => void;
  doneDisabled: boolean;
  children: ReactNode;
}

const ROW = "border-b bg-background px-4 py-4";

export function AnnotationToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  thickness,
  onThicknessChange,
  textSize,
  onTextSizeChange,
  hasSelection,
  selectionIsStroke,
  selectionIsText,
  onDelete,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCancel,
  onDone,
  doneDisabled,
  children,
}: AnnotationToolbarProps) {
  const t = useT();
  // 그리기 도구거나, select 모드에서 도형이 선택돼 있으면 색상/두께 행을 노출(선택 도형 재스타일).
  // tool이 null(초기 무선택)이면 숨김.
  const showStyleRow = (tool !== null && tool !== "select") || hasSelection;
  const thicknessEnabled =
    tool === "select" ? selectionIsStroke : tool !== null && isStrokeTool(tool);
  // text 도구이거나 select 모드에서 text 도형을 선택했으면 두께 대신 텍스트 크기를 노출.
  const showTextSize = tool === "text" || (tool === "select" && selectionIsText);

  const renderTool = ({ key, labelKey }: AnnotationToolMeta) => {
    const Icon = TOOL_ICONS[key];
    const active = tool === key;
    return (
      <Button
        key={key}
        size="icon"
        variant="outline"
        className={cn("h-8 w-8 shrink-0", active && "bg-muted")}
        data-active={active || undefined}
        data-testid={`annotation-tool-${key}`}
        aria-label={t(labelKey)}
        title={t(labelKey)}
        aria-pressed={active}
        onClick={() => onToolChange(key)}
      >
        <Icon />
      </Button>
    );
  };

  const selectTool = ANNOTATION_TOOLS.find((m) => m.key === "select");
  const drawTools = ANNOTATION_TOOLS.filter((m) => m.key !== "select");

  return (
    <div className="flex h-full flex-col">
      {/* 1단: [선택] [그리기 도구] [삭제] */}
      <div className={cn(ROW, "flex items-center justify-between gap-2")}>
        {selectTool ? renderTool(selectTool) : null}
        <ButtonGroup className="flex-nowrap overflow-x-auto">
          {drawTools.map(renderTool)}
        </ButtonGroup>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={!hasSelection}
          data-testid="annotation-delete"
          aria-label={t("annotation.delete")}
          title={t("annotation.delete")}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>

      {/* 2단: 색상 + 두께. select 도구면 내용만 invisible로 숨겨 높이를 예약하되,
          배경은 canvas와 같은 bg-muted/50로 둬 회색이 끊기지 않게 한다. inert로 포커스 차단. */}
      <div
        ref={(el) => {
          if (el) el.inert = !showStyleRow;
        }}
        className={cn(
          "flex items-center justify-between gap-2 px-4 py-4",
          showStyleRow ? "border-b bg-background" : "bg-muted/70",
        )}
      >
        <ButtonGroup className={cn("flex-nowrap", !showStyleRow && "invisible")}>
          {ANNOTATION_COLORS.map((c, i) => {
            const active = color === c;
            return (
              <Button
                key={c}
                size="icon"
                variant="outline"
                className={cn("h-8 w-8 shrink-0", active && "bg-muted")}
                data-active={active || undefined}
                data-testid={`annotation-color-${i}`}
                aria-label={t(COLOR_LABEL_KEYS[i])}
                title={t(COLOR_LABEL_KEYS[i])}
                aria-pressed={active}
                onClick={() => onColorChange(c)}
              >
                <span
                  className="h-4 w-4 rounded-full border"
                  style={{ backgroundColor: c }}
                />
              </Button>
            );
          })}
        </ButtonGroup>
        {showTextSize ? (
          <ButtonGroup className="flex-nowrap">
            {TEXT_SIZE_KEYS.map((key) => {
              const active = textSize === key;
              return (
                <Button
                  key={key}
                  size="icon"
                  variant="outline"
                  className={cn("h-8 w-8 shrink-0", active && "bg-muted")}
                  data-active={active || undefined}
                  data-testid={`annotation-textsize-${key}`}
                  aria-label={t(TEXTSIZE_LABEL_KEYS[key])}
                  title={t(TEXTSIZE_LABEL_KEYS[key])}
                  aria-pressed={active}
                  onClick={() => onTextSizeChange(key)}
                >
                  <span
                    className="font-semibold leading-none"
                    style={{ fontSize: TEXTSIZE_ICON[key] }}
                  >
                    A
                  </span>
                </Button>
              );
            })}
          </ButtonGroup>
        ) : (
          <ButtonGroup className={cn("flex-nowrap", !showStyleRow && "invisible")}>
            {THICKNESS_KEYS.map((key) => {
              const active = thickness === key;
              return (
                <Button
                  key={key}
                  size="icon"
                  variant="outline"
                  className={cn("h-8 w-8 shrink-0", active && "bg-muted")}
                  data-active={active || undefined}
                  data-testid={`annotation-thickness-${key}`}
                  disabled={!thicknessEnabled}
                  aria-label={t(THICKNESS_LABEL_KEYS[key])}
                  title={t(THICKNESS_LABEL_KEYS[key])}
                  aria-pressed={active}
                  onClick={() => onThicknessChange(key)}
                >
                  <Minus strokeWidth={THICKNESS_STROKE[key]} />
                </Button>
              );
            })}
          </ButtonGroup>
        )}
      </div>

      {/* canvas 영역 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/70">
        {children}
      </div>

      {/* 3단: undo/redo + cancel/done */}
      <div className="flex items-center justify-between gap-2 border-t bg-background px-4 py-4">
        <ButtonGroup>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            disabled={!canUndo}
            data-testid="annotation-undo"
            aria-label={t("annotation.undo")}
            title={t("annotation.undo")}
            onClick={onUndo}
          >
            <Undo2 />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            disabled={!canRedo}
            data-testid="annotation-redo"
            aria-label={t("annotation.redo")}
            title={t("annotation.redo")}
            onClick={onRedo}
          >
            <Redo2 />
          </Button>
        </ButtonGroup>
        <ButtonGroup>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            data-testid="annotation-cancel"
            aria-label={t("annotation.cancel")}
            title={t("annotation.cancel")}
            onClick={onCancel}
          >
            <X />
          </Button>
          <Button
            size="icon"
            className="h-8 w-8"
            disabled={doneDisabled}
            data-testid="annotation-done"
            aria-label={t("annotation.done")}
            title={t("annotation.done")}
            onClick={onDone}
          >
            <Check />
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}
