import { Blocks, Info } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export function IntegrationsCta({
  onNavigate,
  className,
}: {
  onNavigate: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="integrations-cta"
      onClick={onNavigate}
      className={cn(
        "flex items-center justify-between rounded-t-lg px-3.5 py-2.5 transition-colors",
        "bg-amber-100/80 text-amber-700 hover:bg-amber-100",
        "dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Info className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm">{t("platform.cta.body")}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
        <Blocks className="h-4 w-4" />
        {t("platform.cta.action")}
      </span>
    </button>
  );
}
