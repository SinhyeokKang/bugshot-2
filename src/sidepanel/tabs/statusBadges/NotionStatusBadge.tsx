import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import type { NotionDatabaseSchema, NotionPageStatus } from "@/types/notion";
import { sendBg } from "@/types/messages";
import { notionStatusCategory } from "@/sidepanel/tabs/notionStatusColors";
import { STATUS_CATEGORY_COLORS } from "./constants";

export function NotionStatusBadge({
  pageId,
  databaseId,
  issueId,
  currentOption,
  onStatusChanged,
}: {
  pageId: string;
  databaseId: string;
  issueId: string;
  currentOption: { name: string; color: string };
  onStatusChanged: (s: NotionPageStatus) => void;
}) {
  const t = useT();
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Array<{ id: string; name: string; color: string }> | null>(null);
  const [statusPropertyName, setStatusPropertyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const category = notionStatusCategory(currentOption.color);
  const colors = STATUS_CATEGORY_COLORS[category];

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v && !options) {
      setLoading(true);
      sendBg<NotionDatabaseSchema>({ type: "notion.getDatabaseSchema", databaseId })
        .then((schema) => {
          setOptions(schema.statusProperty?.options ?? []);
          setStatusPropertyName(schema.statusProperty?.name ?? null);
        })
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }
    if (!v) { setOptions(null); setStatusPropertyName(null); }
  };

  const handleSelect = (optionName: string) => {
    if (updating || optionName === currentOption.name || !statusPropertyName) return;
    setOpen(false);
    setUpdating(true);
    sendBg<NotionPageStatus>({
      type: "notion.updatePageStatus",
      pageId,
      propertyName: statusPropertyName,
      optionName,
    })
      .then((res) => {
        onStatusChanged(res);
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        if (res.statusOption) patch.notionStatusOption = res.statusOption.name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => toast.error(t("issueList.notion.statusUpdateFailed")))
      .finally(() => setUpdating(false));
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => e.stopPropagation()}
          disabled={updating}
        >
          <Badge
            variant="outline"
            className={`relative w-fit border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText} ${updating ? "opacity-50" : ""}`}
          >
            {updating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {currentOption.name}
            {!updating && <ChevronDown className="ml-0.5 !size-3.5" />}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-h-[300px] overflow-y-auto p-1"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center px-4 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : options && options.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {t("issueList.notion.noStatusOptions")}
          </div>
        ) : (
          options?.map((opt) => {
            const optCategory = notionStatusCategory(opt.color);
            const optColors = STATUS_CATEGORY_COLORS[optCategory];
            return (
              <button
                key={opt.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelect(opt.name)}
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${opt.name === currentOption.name ? "opacity-100" : "opacity-0"}`} />
                <Badge
                  variant="outline"
                  className={`border-transparent text-[11px] ${optColors.bg} ${optColors.text} ${optColors.darkBg} ${optColors.darkText}`}
                >
                  {opt.name}
                </Badge>
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
