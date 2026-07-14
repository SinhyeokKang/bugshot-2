import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from "react-konva";
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
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_SIZE_KEYS,
  isStrokeTool,
  type AnnotationTool,
  type TextSizeKey,
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
  centerAnchoredScroll,
  fitAllScale,
  fitWidthScale,
  normalizeZoom,
  PAN_CLICK_THRESHOLD,
  panScroll,
  resolveScale,
  ZOOM_EPS,
  type ZoomLevel,
} from "./annotation/viewport";
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
  shape: TextShape; // natural 좌표 텍스트 도형(x/y/width/height/fontSize)
  value: string;
  left: number;
  top: number;
  boxW: number; // 화면 px(natural * scale)
  boxH: number;
  fontSize: number; // 화면 px
}

interface PanOrigin {
  scrollLeft: number;
  scrollTop: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  moved: boolean; // 임계값을 넘겼는가 = 클릭이 아니라 드래그였는가
}

function toolCursor(tool: AnnotationTool, panEnabled: boolean): string {
  if (tool === "select") return panEnabled ? "grab" : "default";
  return "crosshair";
}

// 스크롤 여지가 있으면 팬 가능. 계산으로 복제하면 스크롤바 폭·서브픽셀에서 어긋나므로 DOM을 읽는다.
function canPan(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}

// Konva는 container()가 아니라 그 자식 .konvajs-content에 리스너를 건다. 포인터 캡처는 캡처
// 타깃의 조상으로만 전파되므로, container에 걸면 content가 move/up을 못 받아 드래그가 죽는다.
function pointerTarget(stage: Konva.Stage): HTMLDivElement {
  return stage.content;
}

export default function AnnotationOverlay({
  imageUrl,
  onComplete,
  onCancel,
}: AnnotationOverlayProps) {
  const t = useT();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  // 뷰포트 실측 크기 → fit/fitAll 파생. zoom이 null이면 fit 추종(= 맞춤 상태).
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<ZoomLevel>(null);
  const [panEnabled, setPanEnabled] = useState(false);
  // 팬 제스처 중 — 도형 hover가 grabbing 커서를 덮어쓰지 못하게 잠근다(제스처당 리렌더 2회).
  const [panning, setPanning] = useState(false);
  // 진입 직후에도 팬이 동작해야 하므로 선택 도구로 연다(그리기 도구가 아니라 "그리지 않는 모드").
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [thickness, setThickness] = useState<ThicknessKey>(DEFAULT_THICKNESS);
  const [textSize, setTextSize] = useState<TextSizeKey>(DEFAULT_TEXT_SIZE);
  const [history, setHistory] = useState<History<AnnotationShape[]>>(() => initHistory([]));
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TextEditing | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeMap = useRef(new Map<string, Konva.Node>());
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanOrigin | null>(null);
  const pendingScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);

  const shapes = history.present;

  const natW = image?.naturalWidth ?? 0;
  const natH = image?.naturalHeight ?? 0;
  const fit = fitWidthScale(natW, vp.w);
  const fitAll = fitAllScale(natW, natH, vp.w, vp.h);
  const scale = resolveScale(zoom, fit, fitAll);

  const pushShapes = (updater: (prev: AnnotationShape[]) => AnnotationShape[]) =>
    setHistory((h) => pushHistory(h, updater(h.present)));

  useEffect(() => {
    let cancelled = false;
    loadImage(imageUrl)
      .then((img) => {
        if (cancelled) return;
        setImage(img);
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

  // 뷰포트 실측 → fit/fitAll 파생. rAF로 스케줄해 스크롤바 등장/소멸에 따른 배율 진동을 눌러준다.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [image]);

  // 배율이 바뀌어 콘텐츠 크기가 DOM에 반영된 뒤에 앵커 스크롤을 적용한다(먼저 대입하면 브라우저가 클램프한다).
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const pending = pendingScrollRef.current;
    if (!el || !pending) return;
    pendingScrollRef.current = null;
    el.scrollLeft = pending.scrollLeft;
    el.scrollTop = pending.scrollTop;
  }, [scale]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    setPanEnabled(el ? canPan(el) : false);
  }, [scale, vp.w, vp.h, image]);

  // 패널이 넓어져 fit이 사용자가 고정한 배율을 따라잡으면 그 배율이 스톱 목록에서 사라지므로 맞춤으로
  // 되돌린다(등호 포함 — fit === zoom이면 맞춤과 구별되지 않는데 refit만 못 따라가는 유령 상태가 된다).
  // "all"은 fitAll을 추종하는 의도라 대상이 아니다(fitAll ≤ fit은 항상 참).
  useEffect(() => {
    if (typeof zoom === "number" && zoom <= fit + ZOOM_EPS) setZoom(null);
  }, [zoom, fit]);

  // 편집 중 textarea는 position:fixed라 배율·스크롤이 바뀌면 좌표가 어긋난다 → 스크롤 시 커밋.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !editing) return;
    const onScroll = () => commitText();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 도구별 커서. image dep은 Stage 마운트(이미지 로드) 직후 커서를 재적용하기 위함.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage) stage.container().style.cursor = toolCursor(tool, panEnabled);
  }, [tool, image, panEnabled]);

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
    if (shape.type === "text") {
      const sizeKey = TEXT_SIZE_KEYS.find((k) => TEXT_SIZES[k] === shape.fontSize);
      if (sizeKey) setTextSize(sizeKey);
      return;
    }
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

  // 드래그로 만든 박스를 정규화(음수 방향·클릭 시 기본 크기)해 그 안에 입력할 textarea를 띄운다.
  const startTextBox = (draft: TextShape) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.container().getBoundingClientRect();
    let { x, y, width, height } = draft;
    if (width < 0) {
      x += width;
      width = -width;
    }
    if (height < 0) {
      y += height;
      height = -height;
    }
    if (width < 40) width = 200;
    if (height < draft.fontSize) height = draft.fontSize * 1.6;
    const shape: TextShape = { ...draft, x, y, width, height };
    setEditing({
      shape,
      value: "",
      left: rect.left + x * scale,
      top: rect.top + y * scale,
      boxW: width * scale,
      boxH: height * scale,
      fontSize: draft.fontSize * scale,
    });
  };

  const commitText = () => {
    if (!editing) return;
    const { shape, value } = editing;
    setEditing(null);
    if (!value.trim()) return;
    pushShapes((prev) => [...prev, { ...shape, text: value }]);
  };

  // 배율 변경. 순서가 중요하다 — setZoom으로 콘텐츠 크기를 먼저 바꾸고, 스크롤은 layout effect에서.
  // 반대로 하면 목표 스크롤이 아직 옛 배율의 스크롤 최대치를 넘어 브라우저가 잘라버린다.
  const applyScale = (next: ZoomLevel) => {
    commitText();
    const normalized = typeof next === "number" ? normalizeZoom(next, fit, fitAll) : next;
    const newScale = resolveScale(normalized, fit, fitAll);
    const el = viewportRef.current;
    if (el && newScale !== scale) {
      pendingScrollRef.current = centerAnchoredScroll({
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        contentWidth: natW,
        contentHeight: natH,
        oldScale: scale,
        newScale,
      });
    }
    setZoom(normalized);
  };

  const releaseCapture = (pointerId: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const target = pointerTarget(stage);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };

  const endPan = (): boolean => {
    const pan = panRef.current;
    const stage = stageRef.current;
    if (!pan || !stage) return false;
    panRef.current = null;
    setPanning(false);
    releaseCapture(pan.pointerId);
    // 임계값을 못 넘겼으면 빈 곳 "클릭" — 기존 선택 해제 동작(down에서 up으로 밀렸다).
    if (!pan.moved) setSelectedId(null);
    stage.container().style.cursor = toolCursor(tool, panEnabled);
    return true;
  };

  const handlePointerDown = (e: KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (panRef.current || draftShape) return; // 진행 중인 드래그가 있으면 두 번째 포인터는 무시
    const pt = stage.getPointerPosition();
    if (!pt) return;
    if (tool === "select") {
      if (e.target !== stage) return; // 도형 위 → Konva draggable에 맡긴다
      const el = viewportRef.current;
      if (!el || !canPan(el)) {
        setSelectedId(null);
        return;
      }
      pointerTarget(stage).setPointerCapture(e.evt.pointerId);
      panRef.current = {
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        clientX: e.evt.clientX,
        clientY: e.evt.clientY,
        pointerId: e.evt.pointerId,
        moved: false,
      };
      setPanning(true);
      return;
    }
    if (editing) {
      commitText();
      return;
    }
    // 드래그가 캔버스 밖이나 플로팅 줌 컨트롤 위를 지나가도 도형이 커밋되도록 포인터를 붙잡는다.
    pointerTarget(stage).setPointerCapture(e.evt.pointerId);
    setDraftShape(
      createShape(tool, crypto.randomUUID(), pt, {
        color,
        strokeWidth: ANNOTATION_THICKNESS[thickness],
        fontSize: TEXT_SIZES[textSize],
      }),
    );
  };

  const handlePointerMove = (e: KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    const pan = panRef.current;
    if (pan && stage) {
      if (e.evt.pointerId !== pan.pointerId) return;
      const el = viewportRef.current;
      if (!el) return;
      const dx = e.evt.clientX - pan.clientX;
      const dy = e.evt.clientY - pan.clientY;
      if (!pan.moved && Math.hypot(dx, dy) > PAN_CLICK_THRESHOLD) {
        pan.moved = true;
        stage.container().style.cursor = "grabbing";
      }
      const s = panScroll(pan, { clientX: e.evt.clientX, clientY: e.evt.clientY });
      el.scrollLeft = s.scrollLeft;
      el.scrollTop = s.scrollTop;
      return;
    }
    if (!draftShape) return;
    const pt = stage?.getPointerPosition();
    if (!pt) return;
    setDraftShape(updateShapeDraft(draftShape, pt));
  };

  const handlePointerUp = (e: KonvaEventObject<PointerEvent>) => {
    if (endPan()) return;
    releaseCapture(e.evt.pointerId);
    if (!draftShape) return;
    const d = draftShape;
    setDraftShape(null);
    if (d.type === "text") {
      startTextBox(d);
      return;
    }
    if (isEmptyShape(d)) return;
    pushShapes((prev) => [...prev, d]);
  };

  // 캡처가 강제 해제되면(제스처 취소) 팬은 물론 진행 중인 draft도 버린다 — 유령 도형 방지.
  const handlePointerCancel = (e: KonvaEventObject<PointerEvent>) => {
    if (endPan()) return;
    releaseCapture(e.evt.pointerId);
    setDraftShape(null);
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

  const handleTextSizeChange = (key: TextSizeKey) => {
    setTextSize(key);
    if (selectedId) {
      pushShapes((prev) =>
        prev.map((s) =>
          s.id === selectedId && s.type === "text"
            ? { ...s, fontSize: TEXT_SIZES[key] }
            : s,
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

  const selectedShape = selectedId ? shapes.find((s) => s.id === selectedId) : null;
  const selectionIsStroke = selectedShape != null && isStrokeTool(selectedShape.type);
  const selectionIsText = selectedShape?.type === "text";

  return (
    <div className="fixed inset-0 z-50 bg-background" data-testid="annotation-overlay">
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
          textSize={textSize}
          onTextSizeChange={handleTextSizeChange}
          hasSelection={selectedId !== null}
          selectionIsStroke={selectionIsStroke}
          selectionIsText={selectionIsText}
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
          viewportRef={viewportRef}
          scale={scale}
          zoom={zoom}
          fit={fit}
          fitAll={fitAll}
          onScaleChange={applyScale}
        >
          <div className="m-auto shrink-0" style={{ width: natW * scale, height: natH * scale }}>
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
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
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
                      restCursor={toolCursor(tool, panEnabled)}
                      cursorLocked={panning}
                    />
                  ))}
                  {draftShape ? (
                    draftShape.type === "text" ? (
                      // 텍스트 박스 드래그 중 가이드라인(점선 사각형).
                      <Rect
                        x={Math.min(draftShape.x, draftShape.x + draftShape.width)}
                        y={Math.min(draftShape.y, draftShape.y + draftShape.height)}
                        width={Math.abs(draftShape.width)}
                        height={Math.abs(draftShape.height)}
                        stroke={draftShape.color}
                        strokeWidth={1}
                        dash={[6, 4]}
                        listening={false}
                      />
                    ) : (
                      <ShapeNode
                        shape={draftShape}
                        selectable={false}
                        onSelect={() => {}}
                        onCommit={() => {}}
                        registerRef={() => {}}
                      />
                    )
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
          ref={(el) => el?.focus()}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            // 박스 안 여러 줄 입력이므로 Enter는 줄바꿈. 완료는 바깥 클릭(blur), 취소는 Escape.
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(null);
            }
          }}
          style={{
            position: "fixed",
            left: editing.left,
            top: editing.top,
            width: editing.boxW,
            height: editing.boxH,
            fontSize: editing.fontSize,
            lineHeight: 1.2,
            color: editing.shape.color,
            transformOrigin: "top left",
          }}
          className="z-[60] m-0 resize-none overflow-hidden whitespace-pre-wrap break-words border border-dashed border-foreground/40 bg-transparent p-0 outline-none"
        />
      ) : null}
    </div>
  );
}
