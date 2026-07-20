import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TimelineMarker, MarkerVariant } from "@/log-viewer/markers";
import { clampTooltipLeft } from "@/log-viewer/timeline";
import { cn } from "@/lib/utils";

const VARIANT_COLOR: Record<MarkerVariant, string> = {
  error: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-blue-500",
  pending: "bg-amber-500",
  navigate: "bg-blue-500",
  default: "bg-white",
};

interface TimelineMarkersProps {
  markers: TimelineMarker[];
  className?: string; // 마커 레이어 박스 (높이·위치). 핀은 bottom-0 기준.
  onMarkerClick?: (marker: TimelineMarker) => void;
  onHoverChange?: (hovering: boolean) => void; // 호스트가 다른 툴팁을 억제할 때 사용
}

// 로그뷰어 마커 핀(variant별 색·teardrop)과 호버 툴팁(labelParts, body portal·뷰포트 clamp·상/하 배치)을
// ProgressBar·TrimTimeline이 공유. 툴팁은 portal이라 컨테이너 overflow와 무관하게 항상 보인다.
export function TimelineMarkers({ markers, className, onMarkerClick, onHoverChange }: TimelineMarkersProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ marker: TimelineMarker; x: number; y: number } | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState<number | null>(null);
  const [tooltipAbove, setTooltipAbove] = useState(true);

  const setHoveredState = useCallback(
    (next: { marker: TimelineMarker; x: number; y: number } | null) => {
      setHovered(next);
      onHoverChange?.(next != null);
    },
    [onHoverChange],
  );

  const onMarkerEnter = useCallback(
    (marker: TimelineMarker, e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHoveredState({ marker, x: rect.left + rect.width / 2, y: rect.top });
      setTooltipAbove(rect.top > 60);
    },
    [setHoveredState],
  );

  const onMarkerLeave = useCallback(() => setHoveredState(null), [setHoveredState]);

  // 툴팁 실측 폭으로 뷰포트 안에 clamp (paint 전 실행 → 깜빡임 없음)
  useLayoutEffect(() => {
    if (!hovered || !tooltipRef.current) {
      setTooltipLeft(null);
      return;
    }
    setTooltipLeft(clampTooltipLeft(hovered.x, tooltipRef.current.offsetWidth, window.innerWidth));
  }, [hovered]);

  return (
    <div className={cn("pointer-events-none relative", className)}>
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-label={m.label}
          className={`pointer-events-auto absolute bottom-0 cursor-pointer transition-transform duration-200 ${VARIANT_COLOR[m.variant]} [transform:translateX(-50%)_rotate(-45deg)] hover:[transform:translateX(-50%)_rotate(-45deg)_scale(1.1)]`}
          style={{
            left: `${m.positionPct}%`,
            width: 16,
            height: 16,
            borderRadius: "50% 50% 50% 0",
            transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onMarkerClick?.(m);
          }}
          onMouseEnter={(e) => onMarkerEnter(m, e)}
          onMouseLeave={onMarkerLeave}
        />
      ))}

      {hovered &&
        createPortal(
          <div
            ref={tooltipRef}
            className="pointer-events-none fixed z-50 max-w-[240px] rounded-md border bg-popover p-2.5 font-mono text-mono text-popover-foreground shadow-md break-all"
            style={{
              left: tooltipLeft ?? hovered.x,
              top: tooltipAbove ? hovered.y - 8 : hovered.y + 18,
              transform:
                tooltipLeft == null
                  ? tooltipAbove
                    ? "translate(-50%, -100%)"
                    : "translate(-50%, 0)"
                  : tooltipAbove
                    ? "translateY(-100%)"
                    : "none",
            }}
          >
            {hovered.marker.labelParts.map((p, i) =>
              p.text === "\n" ? <br key={i} /> : <span key={i} className={p.className}>{p.text}</span>,
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
