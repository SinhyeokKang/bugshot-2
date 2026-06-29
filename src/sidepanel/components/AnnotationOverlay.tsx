import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Image as KonvaImage, Layer, Stage, Transformer } from "react-konva";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadImage } from "@/sidepanel/capture";
import { useT } from "@/i18n";
import { AnnotationToolbar } from "./annotation/AnnotationToolbar";
import { ShapeNode, type TransformAttrs } from "./annotation/ShapeNode";
import {
  ANNOTATION_THICKNESS,
  DEFAULT_COLOR,
  DEFAULT_THICKNESS,
  TEXT_FONT_SIZE,
  isStrokeTool,
  type AnnotationTool,
  type ThicknessKey,
} from "./annotation/presets";
import {
  applyTransform,
  createShape,
  isEmptyShape,
  updateShapeDraft,
  type AnnotationShape,
  type TextShape,
} from "./annotation/shapes";
import {
  canRedo as canRedoFn,
  canUndo as canUndoFn,
  initHistory,
  pushHistory,
  redo as redoFn,
  undo as undoFn,
  type History,
} from "./annotation/history";

interface AnnotationOverlayProps {
  imageUrl: string;
  onComplete: (annotatedUrl: string) => void;
  onCancel: () => void;
}

interface TextEditing {
  shape: TextShape;
  value: string;
  left: number;
  top: number;
  fontSize: number;
}

function toolCursor(tool: AnnotationTool): string {
  if (tool === "select") return "default";
  if (tool === "text") return "text";
  return "crosshair";
}

export default function AnnotationOverlay({
  imageUrl,
  onComplete,
  onCancel,
}: AnnotationOverlayProps) {
  const t = useT();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [thickness, setThickness] = useState<ThicknessKey>(DEFAULT_THICKNESS);
  const [history, setHistory] = useState<History<AnnotationShape[]>>(() => initHistory([]));
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TextEditing | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeMap = useRef(new Map<string, Konva.Node>());

  const shapes = history.present;

  const pushShapes = (updater: (prev: AnnotationShape[]) => AnnotationShape[]) =>
    setHistory((h) => pushHistory(h, updater(h.present)));

  useEffect(() => {
    let cancelled = false;
    loadImage(imageUrl)
      .then((img) => {
        if (cancelled) return;
        const maxW = Math.max(1, window.innerWidth - 32);
        const maxH = window.innerHeight * 0.7;
        const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        setImage(img);
        setScale(s);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(t("annotation.loadError"));
        onCancel();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // 도구별 커서. image dep은 Stage 마운트(이미지 로드) 직후 커서를 재적용하기 위함.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage) stage.container().style.cursor = toolCursor(tool);
  }, [tool, image]);

  // 선택 도형에 Transformer attach
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = selectedId ? nodeMap.current.get(selectedId) ?? null : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  // 키보드: undo/redo + 선택 도형 삭제
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setSelectedId(null);
        setHistory((h) => (e.shiftKey ? redoFn(h) : undoFn(h)));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        pushShapes((prev) => prev.filter((s) => s.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedId]);

  const registerRef = (id: string, node: Konva.Node | null) => {
    if (node) nodeMap.current.set(id, node);
    else nodeMap.current.delete(id);
  };

  const handleSelect = (id: string) => {
    if (tool !== "select") return;
    setSelectedId(id);
    // 선택 도형의 현재 스타일을 툴바에 반영(스와치/두께 활성 표시 정합).
    const shape = shapes.find((s) => s.id === id);
    if (!shape) return;
    setColor(shape.color);
    const key = (Object.keys(ANNOTATION_THICKNESS) as ThicknessKey[]).find(
      (k) => ANNOTATION_THICKNESS[k] === shape.strokeWidth,
    );
    if (key) setThickness(key);
  };

  const handleCommitTransform = (id: string, attrs: TransformAttrs) => {
    pushShapes((prev) =>
      prev.map((s) => (s.id === id ? applyTransform(s, attrs) : s)),
    );
  };

  const startTextEditing = (pt: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.container().getBoundingClientRect();
    const id = crypto.randomUUID();
    const shape = createShape("text", id, pt, {
      color,
      strokeWidth: ANNOTATION_THICKNESS[thickness],
    }) as TextShape;
    setEditing({
      shape,
      value: "",
      left: rect.left + pt.x * scale,
      top: rect.top + pt.y * scale,
      fontSize: TEXT_FONT_SIZE * scale,
    });
  };

  const commitText = () => {
    if (!editing) return;
    const { shape, value } = editing;
    setEditing(null);
    if (!value.trim()) return;
    pushShapes((prev) => [...prev, { ...shape, text: value }]);
  };

  const handlePointerDown = (e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pt = stage.getPointerPosition();
    if (!pt) return;
    if (tool === "select") {
      if (e.target === stage) setSelectedId(null);
      return;
    }
    if (editing) {
      commitText();
      return;
    }
    if (tool === "text") {
      startTextEditing(pt);
      return;
    }
    setDraftShape(
      createShape(tool, crypto.randomUUID(), pt, {
        color,
        strokeWidth: ANNOTATION_THICKNESS[thickness],
      }),
    );
  };

  const handlePointerMove = () => {
    if (!draftShape) return;
    const stage = stageRef.current;
    const pt = stage?.getPointerPosition();
    if (!pt) return;
    setDraftShape(updateShapeDraft(draftShape, pt));
  };

  const handlePointerUp = () => {
    if (!draftShape) return;
    const d = draftShape;
    setDraftShape(null);
    if (isEmptyShape(d)) return;
    pushShapes((prev) => [...prev, d]);
  };

  const handleColorChange = (c: string) => {
    setColor(c);
    if (selectedId) {
      pushShapes((prev) =>
        prev.map((s) => (s.id === selectedId ? { ...s, color: c } : s)),
      );
    }
  };

  const handleThicknessChange = (key: ThicknessKey) => {
    setThickness(key);
    if (selectedId) {
      pushShapes((prev) =>
        prev.map((s) =>
          s.id === selectedId ? { ...s, strokeWidth: ANNOTATION_THICKNESS[key] } : s,
        ),
      );
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    pushShapes((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };

  const handleDone = () => {
    const stage = stageRef.current;
    if (!stage || shapes.length === 0) return;
    setSelectedId(null);
    // Transformer 핸들이 export에 찍히지 않도록 즉시 detach(effect 타이밍에 의존하지 않음).
    transformerRef.current?.nodes([]);
    requestAnimationFrame(() => {
      const url = stage.toDataURL({
        mimeType: "image/webp",
        quality: 0.92,
        pixelRatio: 1,
      });
      onComplete(url);
    });
  };

  const natW = image?.naturalWidth ?? 0;
  const natH = image?.naturalHeight ?? 0;

  const selectedShape = selectedId ? shapes.find((s) => s.id === selectedId) : null;
  const selectionIsStroke = selectedShape != null && isStrokeTool(selectedShape.type);

  return (
    <div className="absolute inset-0 z-50 bg-background" data-testid="annotation-overlay">
      {image ? (
        <AnnotationToolbar
          tool={tool}
          onToolChange={(next) => {
            commitText();
            setTool(next);
            if (next !== "select") setSelectedId(null);
          }}
          color={color}
          onColorChange={handleColorChange}
          thickness={thickness}
          onThicknessChange={handleThicknessChange}
          hasSelection={selectedId !== null}
          selectionIsStroke={selectionIsStroke}
          onDelete={handleDelete}
          canUndo={canUndoFn(history)}
          canRedo={canRedoFn(history)}
          onUndo={() => {
            setSelectedId(null);
            setHistory((h) => undoFn(h));
          }}
          onRedo={() => {
            setSelectedId(null);
            setHistory((h) => redoFn(h));
          }}
          onCancel={onCancel}
          onDone={handleDone}
          doneDisabled={shapes.length === 0}
        >
          <div style={{ width: natW * scale, height: natH * scale }}>
            <div
              style={{
                width: natW,
                height: natH,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <Stage
                ref={stageRef}
                width={natW}
                height={natH}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
              >
                <Layer listening={false}>
                  <KonvaImage image={image} />
                </Layer>
                <Layer>
                  {shapes.map((s) => (
                    <ShapeNode
                      key={s.id}
                      shape={s}
                      selectable={tool === "select"}
                      onSelect={() => handleSelect(s.id)}
                      onCommit={(attrs) => handleCommitTransform(s.id, attrs)}
                      registerRef={registerRef}
                    />
                  ))}
                  {draftShape ? (
                    <ShapeNode
                      shape={draftShape}
                      selectable={false}
                      onSelect={() => {}}
                      onCommit={() => {}}
                      registerRef={() => {}}
                    />
                  ) : null}
                  <Transformer ref={transformerRef} rotateEnabled ignoreStroke />
                </Layer>
              </Stage>
            </div>
          </div>
        </AnnotationToolbar>
      ) : (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(null);
            }
          }}
          style={{
            position: "fixed",
            left: editing.left,
            top: editing.top,
            fontSize: editing.fontSize,
            lineHeight: 1,
            color: editing.shape.color,
            transformOrigin: "top left",
          }}
          className="z-[60] m-0 min-w-[1ch] resize-none overflow-hidden border-none bg-transparent p-0 outline-none"
        />
      ) : null}
    </div>
  );
}
