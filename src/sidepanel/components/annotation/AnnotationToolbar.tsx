import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  Highlighter,
  Minus,
  MousePointer2,
  Pen,
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
  isStrokeTool,
  type AnnotationTool,
  type ThicknessKey,
} from "./presets";

const TOOL_ICONS: Record<AnnotationTool, LucideIcon> = {
  select: MousePointer2,
  arrow: ArrowUpRight,
  rect: Square,
  ellipse: Circle,
  pen: Pen,
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

interface AnnotationToolbarProps {
  tool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  thickness: ThicknessKey;
  onThicknessChange: (key: ThicknessKey) => void;
  hasSelection: boolean;
  // 선택된 도형이 stroke 계열(arrow/rect/ellipse/pen)인지 — select 모드 두께 활성 판정
  selectionIsStroke: boolean;
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
  hasSelection,
  selectionIsStroke,
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
  const showStyleRow = tool !== "select" || hasSelection;
  const thicknessEnabled =
    tool === "select" ? selectionIsStroke : isStrokeTool(tool);

  return (
    <div className="flex h-full flex-col">
      {/* 1단: 도구 + 삭제 */}
      <div className={cn(ROW, "flex items-center justify-between gap-2")}>
        <ButtonGroup className="flex-nowrap overflow-x-auto">
          {ANNOTATION_TOOLS.map(({ key, labelKey }) => {
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
          })}
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

      {/* 2단: 색상 + 두께 (select 도구면 내용 숨김, 높이는 예약). inert로 숨김 시 키보드 포커스도 제거. */}
      <div
        ref={(el) => {
          if (el) el.inert = !showStyleRow;
        }}
        className={cn(ROW, "flex items-center justify-between gap-2", !showStyleRow && "invisible")}
      >
        <ButtonGroup className="flex-nowrap">
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
        <ButtonGroup className="flex-nowrap">
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
      </div>

      {/* canvas 영역 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/50">
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
        <div className="flex items-center gap-2">
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
        </div>
      </div>
    </div>
  );
}
