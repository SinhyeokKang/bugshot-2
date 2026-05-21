import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import type { LinearIssueStatus, LinearWorkflowState } from "@/types/linear";
import { sendBg } from "@/types/messages";
import { LINEAR_STATE_TYPE_COLORS, STATUS_CATEGORY_COLORS, LINEAR_STATE_I18N } from "./constants";

export function LinearStatusBadge({
  issueId,
  issueIdentifier,
  currentState,
  onStatusChanged,
}: {
  issueId: string;
  issueIdentifier: string;
  currentState: { name: string; type: string };
  onStatusChanged: (s: LinearIssueStatus) => void;
}) {
  const t = useT();
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [open, setOpen] = useState(false);
  const [states, setStates] = useState<LinearWorkflowState[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const stateColors = LINEAR_STATE_TYPE_COLORS[currentState.type] ?? STATUS_CATEGORY_COLORS.new;
  const i18nKey = LINEAR_STATE_I18N[currentState.type] as Parameters<typeof t>[0] | undefined;
  const currentLabel = i18nKey ? t(i18nKey) : currentState.name;

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v && !states) {
      setLoading(true);
      sendBg<LinearWorkflowState[]>({ type: "linear.getWorkflowStates", issueIdentifier })
        .then(setStates)
        .catch(() => setStates([]))
        .finally(() => setLoading(false));
    }
    if (!v) setStates(null);
  };

  const handleSelect = (state: LinearWorkflowState) => {
    if (updating || state.name === currentState.name) return;
    setOpen(false);
    setUpdating(true);
    sendBg<LinearIssueStatus>({
      type: "linear.updateIssueState",
      issueId,
      stateId: state.id,
    })
      .then((res) => {
        onStatusChanged(res);
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        if (res.identifier) patch.linearIdentifier = res.identifier;
        if (res.labels.length > 0) patch.linearLabelName = res.labels[0].name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => toast.error(t("issueList.linear.statusUpdateFailed")))
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
            className={`relative w-fit border-transparent text-[11px] ${stateColors.bg} ${stateColors.text} ${stateColors.darkBg} ${stateColors.darkText} ${updating ? "opacity-50" : ""}`}
          >
            {updating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {currentLabel}
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
        ) : (
          states?.map((st) => {
            const stColors = LINEAR_STATE_TYPE_COLORS[st.type] ?? STATUS_CATEGORY_COLORS.new;
            return (
              <button
                key={st.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelect(st)}
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${st.name === currentState.name ? "opacity-100" : "opacity-0"}`} />
                <Badge
                  variant="outline"
                  className={`border-transparent text-[11px] ${stColors.bg} ${stColors.text} ${stColors.darkBg} ${stColors.darkText}`}
                >
                  {st.name}
                </Badge>
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
