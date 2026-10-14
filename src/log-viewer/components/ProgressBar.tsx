import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TimelineMarker } from "@/log-viewer/markers";
import { formatPlayerTime } from "@/log-viewer/timeline";
import { t } from "@/log-viewer/i18n";
import { TimelineMarkers } from "./TimelineMarkers";

interface ProgressBarProps {
  currentPct: number;
  durationSec: number;
  markers: TimelineMarker[];
  onSeek: (pct: number) => void;
  onMarkerClick: (marker: TimelineMarker) => void;
}

const DRAG_THRESHOLD = 5;

export function ProgressBar({ currentPct, durationSec, markers, onSeek, onMarkerClick }: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [markerHovered, setMarkerHovered] = useState(false);
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

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    const stepPct = (5 / durationSec) * 100;
    let nextPct: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp": nextPct = currentPct + stepPct; break;
      case "ArrowLeft":
      case "ArrowDown": nextPct = currentPct - stepPct; break;
      case "Home": nextPct = 0; break;
      case "End": nextPct = 100; break;
      default: return;
    }
    event.preventDefault();
    onSeek(Math.min(100, Math.max(0, nextPct)));
  };

  return (
    <div className="relative flex-1">
      {/* Marker area */}
      <TimelineMarkers
        markers={markers}
        className="h-6 mb-2.5"
        onMarkerClick={onMarkerClick}
        onHoverChange={setMarkerHovered}
      />

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
          className="relative h-2 rounded-full bg-white/20 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          role="slider"
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label={t("logViewer.player.progressBar")}
          aria-valuenow={(durationSec * currentPct) / 100}
          aria-valuetext={`${formatPlayerTime((durationSec * currentPct) / 100)} / ${formatPlayerTime(durationSec)}`}
          aria-valuemin={0}
          aria-valuemax={durationSec}
        >
          <div
            className="pointer-events-none h-full rounded-full bg-white/90"
            style={{ width: `${currentPct}%` }}
          />
        </div>
      </div>

      {/* Time tooltip */}
      {barHover && !markerHovered && durationSec > 0 && createPortal(
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
