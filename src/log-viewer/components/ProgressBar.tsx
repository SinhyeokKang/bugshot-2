import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TimelineMarker, MarkerVariant } from "../markers";
import { clampTooltipLeft, formatPlayerTime } from "../timeline";
import { t } from "../i18n";

interface ProgressBarProps {
  currentPct: number;
  durationSec: number;
  markers: TimelineMarker[];
  onSeek: (pct: number) => void;
  onMarkerClick: (marker: TimelineMarker) => void;
}

const VARIANT_COLOR: Record<MarkerVariant, string> = {
  error: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-blue-500",
  pending: "bg-amber-500",
  navigate: "bg-blue-500",
  default: "bg-white",
};

const DRAG_THRESHOLD = 5;

export function ProgressBar({ currentPct, durationSec, markers, onSeek, onMarkerClick }: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ marker: TimelineMarker; x: number; y: number } | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState<number | null>(null);
  const [tooltipAbove, setTooltipAbove] = useState(true);
  const [barHover, setBarHover] = useState<{ x: number; y: number; pct: number } | null>(null);
  const dragStartX = useRef<number | null>(null);
  const didDrag = useRef(false);

  const pctFromEvent = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    didDrag.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartX.current == null) return;
    if (!didDrag.current && Math.abs(e.clientX - dragStartX.current) >= DRAG_THRESHOLD) {
      didDrag.current = true;
    }
    if (didDrag.current) {
      onSeek(pctFromEvent(e.clientX));
    }
  }, [onSeek, pctFromEvent]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDrag = didDrag.current;
    dragStartX.current = null;
    didDrag.current = false;
    if (!wasDrag) {
      onSeek(pctFromEvent(e.clientX));
    }
  }, [onSeek, pctFromEvent]);

  const onMarkerEnter = useCallback((marker: TimelineMarker, e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setHovered({ marker, x: rect.left + rect.width / 2, y: rect.top });
    setTooltipAbove(rect.top > 60);
  }, []);

  const onMarkerLeave = useCallback(() => {
    setHovered(null);
  }, []);

  // 툴팁 실측 폭으로 뷰포트 안에 clamp (paint 전 실행 → 깜빡임 없음)
  useLayoutEffect(() => {
    if (!hovered || !tooltipRef.current) {
      setTooltipLeft(null);
      return;
    }
    const width = tooltipRef.current.offsetWidth;
    setTooltipLeft(clampTooltipLeft(hovered.x, width, window.innerWidth));
  }, [hovered]);

  return (
    <div className="relative flex-1">
      {/* Marker area */}
      <div className="relative h-6 mb-2.5">
        {markers.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={m.label}
            className={`absolute bottom-0 cursor-pointer transition-transform duration-200 ${VARIANT_COLOR[m.variant]} [transform:translateX(-50%)_rotate(-45deg)] hover:[transform:translateX(-50%)_rotate(-45deg)_scale(1.1)]`}
            style={{
              left: `${m.positionPct}%`,
              width: 16,
              height: 16,
              borderRadius: "50% 50% 50% 0",
              transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
            onClick={(e) => { e.stopPropagation(); onMarkerClick(m); }}
            onMouseEnter={(e) => onMarkerEnter(m, e)}
            onMouseLeave={onMarkerLeave}
          />
        ))}
      </div>

      {/* Bar — 클릭(seek) + 호버(tooltip) 동일 영역 */}
      <div
        className="-mt-1 pt-1 pb-3 -mb-3 cursor-pointer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseMove={(e) => {
          const rect = barRef.current?.getBoundingClientRect();
          if (!rect || rect.width === 0) return;
          const pct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
          setBarHover({ x: e.clientX, y: rect.top, pct });
        }}
        onMouseLeave={() => setBarHover(null)}
      >
        <div
          ref={barRef}
          className="relative h-2 rounded-full bg-white/20 backdrop-blur-sm"
          role="slider"
          aria-label={t("logViewer.player.progressBar")}
          aria-valuenow={Math.round(currentPct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="pointer-events-none h-full rounded-full bg-white/90"
            style={{ width: `${currentPct}%` }}
          />
        </div>
      </div>

      {/* Marker tooltip — portal to body to escape stacking context */}
      {hovered && createPortal(
        <div
          ref={tooltipRef}
          className="pointer-events-none fixed z-50 max-w-[240px] rounded-md bg-white p-2.5 text-xs text-gray-900 shadow-md break-all"
          style={{
            left: tooltipLeft ?? hovered.x,
            top: tooltipAbove ? hovered.y - 8 : hovered.y + 18,
            transform: tooltipLeft == null
              ? (tooltipAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)")
              : (tooltipAbove ? "translateY(-100%)" : "none"),
          }}
        >
          {hovered.marker.labelParts.map((p, i) =>
            p.text === "\n" ? <br key={i} /> : <span key={i} className={p.className}>{p.text}</span>,
          )}
        </div>,
        document.body,
      )}

      {/* Time tooltip */}
      {barHover && !hovered && durationSec > 0 && createPortal(
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-black/80 px-2 py-1 text-xs text-white shadow-md"
          style={{
            left: barHover.x,
            top: barHover.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          {formatPlayerTime((durationSec * barHover.pct) / 100)}
        </div>,
        document.body,
      )}
    </div>
  );
}
