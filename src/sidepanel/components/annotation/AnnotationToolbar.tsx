import type { ReactNode, RefObject } from "react";
import { Check, Minimize2, Redo2, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { TooltipIconButton } from "../TooltipIconButton";
import { ZoomControl } from "./ZoomControl";
import type { ZoomLevel } from "./viewport";
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
  tool: AnnotationTool;
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
  viewportRef: RefObject<HTMLDivElement>;
  scale: number;
  // null이면 맞춤 상태 — 맞춤 버튼 노출 판정의 단일 출처(scale === fit이 아니다).
  zoom: ZoomLevel;
  fit: number;
  fitAll: number;
  onScaleChange: (zoom: ZoomLevel) => void;
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
  viewportRef,
  scale,
  zoom,
  fit,
  fitAll,
  onScaleChange,
  children,
}: AnnotationToolbarProps) {
  const t = useT();
  // 그리기 도구거나, select 모드에서 도형이 선택돼 있으면 색상/두께 행을 노출(선택 도형 재스타일).
  const showStyleRow = tool !== "select" || hasSelection;
  const thicknessEnabled = tool === "select" ? selectionIsStroke : isStrokeTool(tool);
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

      {/* canvas 영역: 스크롤 뷰포트 + 플로팅 줌 컨트롤.
          items-center 대신 children의 m-auto로 중앙정렬 — flex 중앙정렬은 콘텐츠가 넘칠 때
          좌·상단이 스크롤로 도달 불가해진다(확대하면 반드시 그 상황이 된다). */}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          role="group"
          tabIndex={0}
          aria-label={t("annotation.canvasViewport")}
          data-testid="annotation-canvas-viewport"
          className="flex flex-1 overflow-auto overscroll-contain bg-muted [scrollbar-gutter:stable]"
        >
          {children}
        </div>
        {/* 그리기 중에는 컨트롤이 캔버스를 가려 그 아래에서 드래그를 시작할 수 없다 →
            선택 도구가 아닐 땐 흐리게 + inert(포인터·포커스 통과). 줌 조작은 선택 도구로 돌아와서. */}
        <div
          ref={(el) => {
            if (el) el.inert = tool !== "select"; // hit-test·포커스 동시 차단(스타일 행과 같은 관용구)
          }}
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3 transition-opacity",
            tool !== "select" && "opacity-30",
          )}
        >
          {zoom !== null ? (
            <TooltipIconButton
              label={t("annotation.zoomFit")}
              testId="annotation-zoom-fit"
              className="pointer-events-auto bg-background/90 shadow-md backdrop-blur-sm"
              onClick={() => onScaleChange(null)}
            >
              <Minimize2 />
            </TooltipIconButton>
          ) : (
            <span />
          )}
          <div className="pointer-events-auto">
            <ZoomControl
              scale={scale}
              zoom={zoom}
              fit={fit}
              fitAll={fitAll}
              onChange={onScaleChange}
            />
          </div>
        </div>
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
