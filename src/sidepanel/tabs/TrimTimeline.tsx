import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import type { TrimMarker } from "@/sidepanel/30s-replay/trim-markers";

interface TrimTimelineProps {
  durationSec: number;
  currentPct: number; // 재생 위치(표시만)
  startSec: number;
  endSec: number;
  markers: TrimMarker[]; // 에러 마커(표시만)
  disabled?: boolean;
  onTrimChange: (startSec: number, endSec: number) => void;
}

// trim 듀얼 핸들만 대화형(Slider). 재생 위치·에러 마커는 pointer-events-none 비대화형 레이어로 겹쳐
// Slider 포인터 이벤트를 가로채지 않는다.
export function TrimTimeline({
  durationSec,
  currentPct,
  startSec,
  endSec,
  markers,
  disabled,
  onTrimChange,
}: TrimTimelineProps) {
  const t = useT();
  const ready = durationSec > 0;
  const isDisabled = disabled || !ready;
  const playheadPct = Number.isFinite(currentPct) ? Math.min(100, Math.max(0, currentPct)) : 0;

  return (
    <div className="relative flex-1">
      <Slider
        value={[startSec, endSec]}
        min={0}
        max={ready ? durationSec : 1}
        step={0.1}
        minStepsBetweenThumbs={1}
        disabled={isDisabled}
        onValueChange={(v) => onTrimChange(v[0], v[1])}
        thumbAriaLabels={[t("issue.replay.trim.trimStart"), t("issue.replay.trim.trimEnd")]}
      />
      {ready && (
        <div className="pointer-events-none absolute inset-0">
          {markers.map((m) => (
            <div
              key={`${m.type}-${m.id}`}
              aria-hidden
              className={cn("absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-red-500")}
              style={{ left: `${m.positionPct}%` }}
            />
          ))}
          <div
            aria-hidden
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
