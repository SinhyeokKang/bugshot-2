import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { originHostLabel, UNKNOWN_ORIGIN } from "@/sidepanel/lib/logOrigin";

interface OriginFilterBarProps {
  originKeys: string[];
  counts?: Record<string, number>;
  value: string | null;
  onChange: (key: string | null) => void;
  flush?: boolean;
}

// cross-origin(주로 iframe) 로그가 섞여 origin이 2개 이상일 때만 노출하는 출처별 필터 바.
// Console·Network·Action 로그 뷰 공용.
export function OriginFilterBar({ originKeys, counts, value, onChange, flush }: OriginFilterBarProps) {
  const t = useT();
  if (originKeys.length < 2) return null;
  return (
    <div className={`flex overflow-x-auto border-b ${flush ? "px-4 pb-4" : "px-2 pb-2"}`}>
      <ButtonGroup>
        {originKeys.map((k) => (
          <Button
            key={k}
            size="sm"
            variant="outline"
            className={`shrink-0 gap-1 font-normal h-7 px-2.5 text-[13px]${value === k ? " bg-muted hover:bg-muted hover:brightness-95" : ""}`}
            onClick={() => onChange(value === k ? null : k)}
            data-testid="origin-filter"
            data-origin={k}
            data-active={value === k || undefined}
          >
            {k === UNKNOWN_ORIGIN ? t("log.originFilter.unknown") : originHostLabel(k)}
            {counts && <span className="text-xs text-muted-foreground">{counts[k] ?? 0}</span>}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}
