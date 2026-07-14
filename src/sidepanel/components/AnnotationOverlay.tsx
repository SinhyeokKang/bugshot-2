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
  canPan,
  centerAnchoredScroll,
  fitAllScale,
  fitWidthScale,
  normalizeZoom,
  PAN_CLICK_THRESHOLD,
  panScroll,
  refitZoom,
  resolveScale,
  toolCursor,
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
  const committedRef = useRef<TextEditing | null>(null);
  const drawPointerRef = useRef<number | null>(null);
  const abortRef = useRef<(pointerId: number) => void>(() => {});

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

  // 뷰포트가 바뀌면 줌 의도를 재정규화 — 스톱에서 사라진 배율이 유령 상태로 남지 않게.
  useEffect(() => {
    const next = refitZoom(zoom, fit, fitAll);
    if (next !== zoom) setZoom(next);
  }, [zoom, fit, fitAll]);

  // 편집 중 textarea는 position:fixed라 배율·스크롤이 바뀌면 좌표가 어긋난다 → 둘 다 커밋으로 회피.
  // (배율은 applyScale에서도 커밋하지만, 패널 리사이즈로 fit이 바뀌는 경로는 여기서만 걸린다.)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !editing) return;
    const onScroll = () => commitText();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    commitText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Konva는 DOM pointercancel을 받아도 노드 이벤트 pointercancel을 발화하지 않는다(Stage.js:_pointercancel
  // 은 도형이 있으면 pointerup으로 바꿔 쏘고, 없으면 아무것도 안 쏜다) → react-konva prop으로는 못 잡는다.
  // 캡처 타깃(stage.content)에 네이티브로 직접 건다. 안 걸면 터치 팬을 브라우저가 스크롤로 가져갈 때
  // panRef/draftShape가 남아 이후 모든 제스처가 down 가드에 막힌다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const content = pointerTarget(stage);
    const onAbort = (e: PointerEvent) => abortRef.current(e.pointerId);
    content.addEventListener("pointercancel", onAbort);
    content.addEventListener("lostpointercapture", onAbort);
    return () => {
      content.removeEventListener("pointercancel", onAbort);
      content.removeEventListener("lostpointercapture", onAbort);
    };
  }, [image]);

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

  // 여러 경로(blur·스크롤·배율 변경)가 같은 배치에서 겹쳐 부를 수 있다. editing 클로저는 그때까지
  // 갱신되지 않으므로 state 가드만으론 도형이 두 번 push된다 → ref로 커밋 여부를 확정한다.
  const commitText = () => {
    if (!editing || committedRef.current === editing) return;
    committedRef.current = editing;
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

  // 반환 true = 이 포인터 이벤트는 팬이 처리했으니 그리기 경로로 넘기지 않는다.
  const endPan = (pointerId: number): boolean => {
    const pan = panRef.current;
    const stage = stageRef.current;
    if (!pan || !stage) return false;
    if (pointerId !== pan.pointerId) return true; // 팬 중 들어온 다른 포인터는 제스처를 끝내지 못한다
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
    drawPointerRef.current = e.evt.pointerId;
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
    const id = e.evt.pointerId;
    // Konva는 pointercancel을 받으면 포인터 아래 도형에 pointerup을 대신 쏜다(Stage.js:_pointercancel).
    // 그리기 중엔 draft가 항상 포인터 아래라 이 경로로 들어오는데, 취소를 커밋으로 오인하면 안 된다.
    if (e.evt.type !== "pointerup") {
      abortGesture(id);
      return;
    }
    if (endPan(id)) return;
    if (drawPointerRef.current !== id) return; // 그리기를 시작한 포인터의 up만 커밋한다
    drawPointerRef.current = null;
    releaseCapture(id);
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

  // 제스처가 취소되면(터치 팬을 브라우저가 스크롤로 가져감, 캡처 강제 해제 등) 팬도 draft도 버린다.
  const abortGesture = (pointerId: number) => {
    if (typeof pointerId !== "number") return; // touchcancel은 pointerId가 없다
    if (endPan(pointerId)) return;
    if (drawPointerRef.current !== pointerId) return;
    drawPointerRef.current = null;
    releaseCapture(pointerId);
    setDraftShape(null);
  };
  useEffect(() => {
    abortRef.current = abortGesture;
  });

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
                      scale={scale}
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
                        scale={scale}
                      />
                    )
                  ) : null}
                  {/* 앵커·보더도 natural 좌표라 CSS 배율에 비례한다 → 화면에서 일정하게 보이도록 나눈다. */}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled
                    ignoreStroke
                    anchorSize={10 / scale}
                    borderStrokeWidth={1 / scale}
                    anchorStrokeWidth={1 / scale}
                    rotateAnchorOffset={50 / scale}
                  />
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
