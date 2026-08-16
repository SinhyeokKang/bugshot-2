import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { STATUS_CATEGORY_COLORS } from "./constants";

const TEXT_KEY = {
  deleted: "issueList.deleted",
  error: "issueList.unknown",
  loading: "issueList.submitted",
} as const;

export function BadgeFallback({
  kind,
}: {
  kind: "deleted" | "error" | "loading";
}) {
  const t = useT();
  const colors = kind === "deleted" ? STATUS_CATEGORY_COLORS.deleted : null;

  return (
    <Badge
      variant="outline"
      className={`w-fit shrink-0 text-[11px]${colors ? ` border-transparent ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}` : ""}`}
    >
      {t(TEXT_KEY[kind])}
    </Badge>
  );
}
