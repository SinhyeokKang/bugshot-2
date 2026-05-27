import { useT } from "@/i18n";

// 영상-로그 동기화 칩. onSeek 미공급(라이브 서브탭) 시 기존 span과 동일 렌더, 공급 시 점프 button.
export function LogSeekChip({ ts, label, onSeek }: {
  ts: number;
  label: string;
  onSeek?: (absTs: number) => void;
}) {
  const t = useT();
  if (!onSeek) {
    return <span className="w-7 shrink-0 text-xs">{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSeek(ts);
      }}
      aria-label={t("logViewer.seekTo", { time: label })}
      className="w-7 shrink-0 rounded text-left text-xs hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}
