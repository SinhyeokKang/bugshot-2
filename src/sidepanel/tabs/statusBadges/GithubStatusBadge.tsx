import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import type { GithubIssueStatus } from "@/types/github";
import { sendBg } from "@/types/messages";
import { STATUS_CATEGORY_COLORS } from "./constants";

export type GithubBadgeStatus =
  | { kind: "open" }
  | { kind: "closed"; reason: "completed" | "not_planned" | "reopened" | null };

export type GithubTargetState = "open" | "closed_completed" | "closed_not_planned";

export function toGithubTargetState(s: GithubBadgeStatus): GithubTargetState {
  if (s.kind === "open") return "open";
  return s.reason === "not_planned" ? "closed_not_planned" : "closed_completed";
}

export function GithubStatusBadge({
  ghStatus,
  issueId,
  owner,
  repo,
  number,
  onStatusChanged,
}: {
  ghStatus: GithubBadgeStatus;
  issueId: string;
  owner: string;
  repo: string;
  number: number;
  onStatusChanged: (s: GithubBadgeStatus) => void;
}) {
  const t = useT();
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const current = toGithubTargetState(ghStatus);

  const options: { key: GithubTargetState; label: string; colors: typeof STATUS_CATEGORY_COLORS[string] }[] = [
    { key: "open", label: t("issueList.github.status.open"), colors: STATUS_CATEGORY_COLORS.indeterminate },
    { key: "closed_completed", label: t("issueList.github.status.closedCompleted"), colors: STATUS_CATEGORY_COLORS.done },
    { key: "closed_not_planned", label: t("issueList.github.status.closedNotPlanned"), colors: STATUS_CATEGORY_COLORS.new },
  ];

  const currentOption = options.find((o) => o.key === current)!;

  const handleSelect = (target: GithubTargetState) => {
    if (target === current) { setOpen(false); return; }
    setOpen(false);
    setUpdating(true);
    const state = target === "open" ? "open" as const : "closed" as const;
    const stateReason = target === "closed_not_planned" ? "not_planned" as const : target === "closed_completed" ? "completed" as const : null;
    sendBg<GithubIssueStatus>({
      type: "github.updateIssueState",
      owner, repo, number, state,
      ...(stateReason ? { stateReason } : {}),
    })
      .then((res) => {
        const newStatus: GithubBadgeStatus =
          res.state === "open"
            ? { kind: "open" }
            : { kind: "closed", reason: res.stateReason ?? null };
        onStatusChanged(newStatus);
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        patch.githubLabels = res.labels.map((l) => l.name).filter(Boolean);
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => toast.error(t("issueList.github.statusUpdateFailed")))
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
            key={opt.key}
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
