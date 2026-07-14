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
  normalizeZoom,
  stepZoom,
  ZOOM_EPS,
  zoomStops,
  type ZoomLevel,
} from "./viewport";

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

  const step = (dir: 1 | -1) =>
    onChange(normalizeZoom(stepZoom(scale, stops, dir), fit, fitAll));

  return (
    <ButtonGroup className="rounded-md bg-background/90 shadow-md backdrop-blur-sm">
      <TooltipIconButton
        label={t("annotation.zoomOut")}
        testId="annotation-zoom-out"
        className="bg-transparent"
        disabled={atMin}
        onClick={() => step(-1)}
      >
        <Minus />
      </TooltipIconButton>

      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger
          className="h-8 w-[76px] bg-transparent px-2 text-xs"
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
        className="bg-transparent"
        disabled={atMax}
        onClick={() => step(1)}
      >
        <Plus />
      </TooltipIconButton>
    </ButtonGroup>
  );
}
