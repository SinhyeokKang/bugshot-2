import { useRef } from "react";
import { EllipsisVertical } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { TimelineMarkers } from "@/log-viewer/components/TimelineMarkers";
import type { TimelineMarker } from "@/log-viewer/markers";

interface TrimTimelineProps {
  durationSec: number;
  currentPct: number; // 재생 위치(표시만)
  startSec: number;
  endSec: number;
  markers: TimelineMarker[]; // 에러 마커(log-viewer 마커 재사용 — 핀 + 호버 툴팁)
  disabled?: boolean;
  onTrimChange: (startSec: number, endSec: number) => void; // 드래그 중 연속(라이브)
  onTrimCommit: (startSec: number, endSec: number) => void; // 드래그 종료·키 입력 1회(undo 단위)
  onSeek: (sec: number) => void; // 바 스크럽 + 핸들 클릭 시 해당 지점으로 재생 위치 이동
  onMarkerClick?: (marker: TimelineMarker) => void; // 클릭 시 로그 다이얼로그
}

// 인터랙션(Jam 참고): ① 핸들 드래그=트림 ② 바 본체 클릭·드래그=재생 스크럽(전체 구간) ③ 핸들 클릭=그 지점 seek.
// 트림 핸들(투명 트랙 Slider, thumb만 대화형)과 스크럽 레이어(트랙 아래)를 분리해 충돌을 막는다.
// 두꺼운 라운드 바: 트림된 곳=회색 트랙, 선택 구간=흰색 Range. 핸들은 바깥 모서리만 둥근 outline + ⋮(primary).
// 재생 포인터=검은 얇은 세로선(바보다 큼, z 위). 에러 마커는 바 위쪽 핀(겹침 없음)+호버 툴팁(body portal).
export function TrimTimeline({
  durationSec,
  currentPct,
  startSec,
  endSec,
  markers,
  disabled,
  onTrimChange,
  onTrimCommit,
  onSeek,
  onMarkerClick,
}: TrimTimelineProps) {
  const t = useT();
  const ready = durationSec > 0;
  const isDisabled = disabled || !ready;
  const playheadPct = Number.isFinite(currentPct) ? Math.min(100, Math.max(0, currentPct)) : 0;

  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const secFromClientX = (clientX: number): number => {
    const r = scrubRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return p * durationSec;
  };

  return (
    <div className="relative flex-1 py-2">
      {/* mx-5: 핸들 너비만큼 트랙을 줄여 핸들이 선택 바깥에 놓일 자리 + 내부 div가 트랙 좌표계
          → 마커·playhead·스크럽의 %가 트랙과 일치. */}
      <div className="relative mx-5">
        {ready && (
          <TimelineMarkers
            markers={markers}
            className="absolute inset-x-0 bottom-full mb-1.5 h-4"
            onMarkerClick={onMarkerClick}
          />
        )}

        {/* 스크럽 레이어 — 트랙 아래(z 낮음). 트랙은 pointer-events-none이라 바 클릭·드래그가 여기로 떨어져 seek.
            thumb(pointer-events-auto)는 위에 있어 드래그=트림으로 분리된다. */}
        {ready && (
          <div
            ref={scrubRef}
            className="absolute inset-0 cursor-pointer"
            onPointerDown={(e) => {
              scrubbing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              onSeek(secFromClientX(e.clientX));
            }}
            onPointerMove={(e) => {
              if (scrubbing.current) onSeek(secFromClientX(e.clientX));
            }}
            onPointerUp={() => { scrubbing.current = false; }}
          />
        )}

        <Slider
          className="h-8 items-center pointer-events-none"
          value={[startSec, endSec]}
          min={0}
          max={ready ? durationSec : 1}
          step={0.1}
          minStepsBetweenThumbs={1}
          disabled={isDisabled}
          onValueChange={(v) => onTrimChange(v[0], v[1])}
          onValueCommit={(v) => onTrimCommit(v[0], v[1])}
          onThumbClick={(i) => onSeek(i === 0 ? startSec : endSec)}
          thumbAriaLabels={[t("issue.replay.trim.trimStart"), t("issue.replay.trim.trimEnd")]}
          trackClassName="h-8 overflow-visible rounded-lg bg-muted-foreground/20"
          rangeClassName="border-y border-border rounded-none bg-background"
          // thumb은 0폭 위치점(Radix in-bounds offset 무력화 → 어느 위치든 value%에 정확히 정렬).
          thumbClassName="relative h-8 w-0 border-0 bg-transparent p-0 shadow-none"
          thumbContent={(i) => (
            // 실제 핸들 비주얼: 좌핸들=오른쪽 끝을 value에 맞춰 왼쪽으로(우측 모서리 각짐), 우핸들=반대.
            // outline 스타일(흰 배경 + 테두리) + primary 아이콘. hover 커서 포인터, 잡은 시각을 title 툴팁으로.
            <span
              className={cn(
                "group absolute top-1/2 flex h-8 w-5 -translate-y-1/2 cursor-pointer items-center justify-center border border-border bg-white text-primary shadow-sm",
                i === 0 ? "right-0 rounded-l-md" : "left-0 rounded-r-md",
              )}
            >
              <EllipsisVertical className="h-4 w-4" />
              {/* 호버 툴팁: 핸들이 잡은 시각(초). title은 재생 중 리렌더로 hover가 끊겨 CSS group-hover로. */}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity group-hover:opacity-100">
                {Math.round(i === 0 ? startSec : endSec)}s
              </span>
            </span>
          )}
        />

        {/* 재생 포인터 = 트림바와 별개 레이어. z-20으로 핸들·선택바 위. */}
        {ready && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 z-20 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${playheadPct}%` }}
          />
        )}
      </div>
    </div>
  );
}
