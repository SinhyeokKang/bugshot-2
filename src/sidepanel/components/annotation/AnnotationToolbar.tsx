import type { ReactNode } from "react";
import { Check, Redo2, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import {
  ANNOTATION_TOOLS,
  isStrokeTool,
  type AnnotationTool,
  type TextSizeKey,
  type ThicknessKey,
} from "./presets";
import {
  ColorSwatches,
  TextSizeButtons,
  ThicknessButtons,
  ToolButton,
  ToolButtons,
} from "./ToolbarGroups";

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

  const selectTool = ANNOTATION_TOOLS.find((m) => m.key === "select");
  const drawTools = ANNOTATION_TOOLS.filter((m) => m.key !== "select");

  return (
    <div className="flex h-full flex-col">
      {/* 1단: [선택] [그리기 도구] [삭제] */}
      <div className={cn(ROW, "flex items-center justify-between gap-2")}>
        {selectTool ? (
          <ToolButton
            meta={selectTool}
            active={tool === "select"}
            onSelect={onToolChange}
          />
        ) : null}
        <ToolButtons
          tools={drawTools}
          value={tool}
          onChange={onToolChange}
          className="overflow-x-auto"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0 hover:text-destructive"
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
          배경은 canvas와 같은 bg-muted로 둬 회색이 끊기지 않게 한다(trim 오버레이 canvas와 동일 톤). inert로 포커스 차단. */}
      <div
        ref={(el) => {
          if (el) el.inert = !showStyleRow;
        }}
        className={cn(
          "flex items-center justify-between gap-2 px-4 py-4",
          showStyleRow ? "border-b bg-background" : "bg-muted",
        )}
      >
        <ColorSwatches
          value={color}
          onChange={onColorChange}
          className={cn(!showStyleRow && "invisible")}
        />
        {showTextSize ? (
          <TextSizeButtons value={textSize} onChange={onTextSizeChange} />
        ) : (
          <ThicknessButtons
            value={thickness}
            onChange={onThicknessChange}
            disabled={!thicknessEnabled}
            className={cn(!showStyleRow && "invisible")}
          />
        )}
      </div>

      {/* canvas 영역 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted">
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
