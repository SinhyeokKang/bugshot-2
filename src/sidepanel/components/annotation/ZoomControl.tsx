import { Minus, Plus } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/i18n";
import { TooltipIconButton } from "../TooltipIconButton";
import {
  formatZoomPercent,
  MAX_ZOOM,
  stepZoom,
  ZOOM_EPS,
  zoomStops,
  type ZoomLevel,
} from "./viewport";

// aria-disabled는 disabled와 달리 흐림·커서를 자동으로 안 준다(DESIGN "진행 중 잠금" — 툴팁·포커스를 살리려 aria 사용).
const LOCK_CLASS = "bg-transparent aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

interface ZoomControlProps {
  scale: number; // 현재 표시 배율
  zoom: ZoomLevel;
  fit: number;
  fitAll: number;
  onChange: (zoom: ZoomLevel) => void;
}

export function ZoomControl({ scale, zoom, fit, fitAll, onChange }: ZoomControlProps) {
  const t = useT();
  const stops = zoomStops(fit, fitAll);
  // zoomStops가 fitAll을 앞에 끼우는 유일한 주체 — 항목 노출 여부를 그 결과에서 읽는다.
  const hasFitAll = stops[0] < fit - ZOOM_EPS;
  const presets = stops.filter((s) => s > fit + ZOOM_EPS);
  const atMin = scale <= stops[0] + ZOOM_EPS;
  const atMax = scale >= MAX_ZOOM - ZOOM_EPS;

  const selectValue = zoom === null ? "fit" : zoom === "all" ? "all" : String(zoom);

  const handleSelect = (v: string) => {
    if (v === "fit") return onChange(null);
    if (v === "all") return onChange("all");
    onChange(Number(v));
  };

  // 정규화(fit/fitAll로 접기)는 applyScale의 몫 — 여기서 또 하면 규칙이 두 곳에 흩어진다.
  const step = (dir: 1 | -1) => onChange(stepZoom(scale, stops, dir));

  return (
    <ButtonGroup className="rounded-md bg-background/90 shadow-md backdrop-blur-sm">
      <TooltipIconButton
        label={t("annotation.zoomOut")}
        testId="annotation-zoom-out"
        className={LOCK_CLASS}
        ariaDisabled={atMin}
        onClick={() => step(-1)}
      >
        <Minus />
      </TooltipIconButton>

      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger
          className="h-8 w-auto gap-1 bg-transparent px-2 text-xs"
          aria-label={t("annotation.zoomLevel")}
          data-testid="annotation-zoom-level"
        >
          <SelectValue>{formatZoomPercent(scale)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {hasFitAll ? (
            <SelectItem value="all">
              {t("annotation.zoomFitAll")} ({formatZoomPercent(fitAll)})
            </SelectItem>
          ) : null}
          <SelectItem value="fit">
            {t("annotation.zoomFit")} ({formatZoomPercent(fit)})
          </SelectItem>
          {presets.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {formatZoomPercent(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <TooltipIconButton
        label={t("annotation.zoomIn")}
        testId="annotation-zoom-in"
        className={LOCK_CLASS}
        ariaDisabled={atMax}
        onClick={() => step(1)}
      >
        <Plus />
      </TooltipIconButton>
    </ButtonGroup>
  );
}
