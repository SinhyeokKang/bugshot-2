import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { originHostLabel, UNKNOWN_ORIGIN } from "@/sidepanel/lib/logOrigin";

interface OriginFilterBarProps {
  originKeys: string[];
  value: string | null;
  onChange: (key: string | null) => void;
  flush?: boolean;
}

// cross-origin(주로 iframe) 로그가 섞여 origin이 2개 이상일 때만 노출하는 출처별 필터 바.
// Console·Network 로그 뷰 공용.
export function OriginFilterBar({ originKeys, value, onChange, flush }: OriginFilterBarProps) {
  const t = useT();
  if (originKeys.length < 2) return null;
  return (
    <div className={`flex overflow-x-auto border-b ${flush ? "px-4 pb-4 pt-1" : "px-2 pb-2 pt-1"}`}>
      <ButtonGroup>
        {originKeys.map((k) => (
          <Button
            key={k}
            size="sm"
            variant="outline"
            className={`shrink-0 font-normal h-7 px-2.5 text-[13px]${value === k ? " bg-muted hover:bg-muted hover:brightness-95" : ""}`}
            onClick={() => onChange(value === k ? null : k)}
          >
            {k === UNKNOWN_ORIGIN ? t("log.originFilter.unknown") : originHostLabel(k)}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}
