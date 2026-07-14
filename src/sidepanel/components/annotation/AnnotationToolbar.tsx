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
  // 스타일 행의 형태를 정하는 도구 — select(잠금)일 땐 직전 그리기 도구를 그대로 유지해
  // 버튼 종류가 글자크기↔두께로 튀지 않게 한다.
  styleTool: AnnotationTool;
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
  styleTool,
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
  // 선택 도구와 그리기 도구는 상호 배타 — select면 그릴 대상이 없으니 스타일 행 전체를 잠근다.
  // 행은 항상 렌더해 캔버스 높이가 출렁이지 않게 한다.
  const styleDisabled = tool === "select";
  const thicknessEnabled = !styleDisabled && isStrokeTool(styleTool);
  const showTextSize = styleTool === "text";

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

      {/* 2단: 색상 + 두께(텍스트 도구면 글자 크기). 도구 미선택(select) 상태에선 잠긴다. */}
      <div className={cn(ROW, "flex items-center justify-between gap-2")}>
        <ColorSwatches
          value={color}
          onChange={onColorChange}
          disabled={styleDisabled}
        />
        {showTextSize ? (
          <TextSizeButtons
            value={textSize}
            onChange={onTextSizeChange}
            disabled={styleDisabled}
          />
        ) : (
          <ThicknessButtons
            value={thickness}
            onChange={onThicknessChange}
            disabled={!thicknessEnabled}
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
