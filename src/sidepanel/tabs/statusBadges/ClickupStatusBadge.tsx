import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import type { ClickupTaskStatus } from "@/types/clickup";
import { sendBg } from "@/types/messages";
import { STATUS_CATEGORY_COLORS } from "./constants";

export type ClickupBadgeStatus = { completed: boolean };

export function ClickupStatusBadge({
  cuStatus,
  issueId,
  taskId,
  onStatusChanged,
}: {
  cuStatus: ClickupBadgeStatus;
  issueId: string;
  taskId: string;
  onStatusChanged: (s: ClickupBadgeStatus) => void;
}) {
  const t = useT();
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const current = cuStatus.completed;

  const options: {
    key: boolean;
    label: string;
    colors: (typeof STATUS_CATEGORY_COLORS)[string];
  }[] = [
    { key: false, label: t("issueList.clickup.status.incomplete"), colors: STATUS_CATEGORY_COLORS.indeterminate },
    { key: true, label: t("issueList.clickup.status.complete"), colors: STATUS_CATEGORY_COLORS.done },
  ];

  const currentOption = options.find((o) => o.key === current)!;

  const handleSelect = (target: boolean) => {
    if (target === current) {
      setOpen(false);
      return;
    }
    setOpen(false);
    setUpdating(true);
    sendBg<ClickupTaskStatus>({
      type: "clickup.setCompleted",
      taskId,
      completed: target,
    })
      .then((res) => {
        onStatusChanged({ completed: res.completed });
        const patch: Partial<IssueRecord> = {};
        if (res.name) patch.title = res.name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => toast.error(t("issueList.clickup.statusUpdateFailed")))
      .finally(() => setUpdating(false));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => e.stopPropagation()}
          disabled={updating}
        >
          <Badge
            variant="outline"
            className={`relative w-fit border-transparent text-[11px] ${currentOption.colors.bg} ${currentOption.colors.text} ${currentOption.colors.darkBg} ${currentOption.colors.darkText} ${updating ? "opacity-50" : ""}`}
          >
            {updating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {currentOption.label}
            {!updating && <ChevronDown className="ml-0.5 !size-3.5" />}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-1"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((opt) => (
          <button
            key={String(opt.key)}
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleSelect(opt.key)}
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${opt.key === current ? "opacity-100" : "opacity-0"}`} />
            <Badge
              variant="outline"
              className={`border-transparent text-[11px] ${opt.colors.bg} ${opt.colors.text} ${opt.colors.darkBg} ${opt.colors.darkText}`}
            >
              {opt.label}
            </Badge>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
