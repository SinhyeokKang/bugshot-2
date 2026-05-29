import { useCallback, useRef, useState } from "react";
import type { TimelineMarker, MarkerVariant } from "../markers";
import { t } from "../i18n";

interface ProgressBarProps {
  currentPct: number;
  markers: TimelineMarker[];
  onSeek: (pct: number) => void;
  onMarkerClick: (marker: TimelineMarker) => void;
}

const VARIANT_COLOR: Record<MarkerVariant, string> = {
  error: "bg-red-500",
  warn: "bg-amber-500",
  pending: "bg-amber-500",
  navigate: "bg-sky-500",
  default: "bg-primary",
};

const DRAG_THRESHOLD = 5;

export function ProgressBar({ currentPct, markers, onSeek, onMarkerClick }: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ marker: TimelineMarker; x: number; y: number } | null>(null);
  const [tooltipAbove, setTooltipAbove] = useState(true);
  const dragStartX = useRef<number | null>(null);
  const didDrag = useRef(false);
  const clickedMarker = useRef<TimelineMarker | null>(null);

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
      if (clickedMarker.current) {
        onMarkerClick(clickedMarker.current);
      } else {
        onSeek(pctFromEvent(e.clientX));
      }
    }
    clickedMarker.current = null;
  }, [onSeek, onMarkerClick, pctFromEvent]);

  const onMarkerPointerDown = useCallback((marker: TimelineMarker) => {
    clickedMarker.current = marker;
  }, []);

  const onMarkerEnter = useCallback((marker: TimelineMarker, e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setHovered({ marker, x: rect.left + rect.width / 2, y: rect.top });
    setTooltipAbove(rect.top > 60);
  }, []);

  const onMarkerLeave = useCallback(() => {
    setHovered(null);
  }, []);

  return (
    <div
      className="relative flex-1 cursor-pointer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Marker area — fixed height to prevent layout jump */}
      <div className="relative h-3 mb-0.5">
        {markers.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={m.label}
            className={`absolute bottom-0 -translate-x-1/2 cursor-pointer transition-transform hover:scale-110 ${VARIANT_COLOR[m.variant]}`}
            style={{
              left: `${m.positionPct}%`,
              width: 7,
              height: 10,
              clipPath: "polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)",
            }}
            onPointerDown={() => onMarkerPointerDown(m)}
            onMouseEnter={(e) => onMarkerEnter(m, e)}
            onMouseLeave={onMarkerLeave}
          />
        ))}
      </div>

      {/* Bar */}
      <div
        ref={barRef}
        className="relative h-2 rounded-full bg-muted"
        role="slider"
        aria-label={t("logViewer.player.progressBar")}
        aria-valuenow={Math.round(currentPct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="pointer-events-none h-full rounded-full bg-primary"
          style={{ width: `${currentPct}%` }}
        />
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-xl bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md line-clamp-2"
          style={{
            left: hovered.x,
            top: tooltipAbove ? hovered.y - 8 : hovered.y + 18,
            transform: tooltipAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
          }}
        >
          {hovered.marker.label}
        </div>
      )}
    </div>
  );
}
