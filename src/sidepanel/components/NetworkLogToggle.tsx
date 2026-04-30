import { Eye } from "lucide-react";
import { useT } from "@/i18n";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface NetworkLogToggleProps {
  captured: number;
  selectedCount: number;
  attach: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
  onPreview: () => void;
}

export function NetworkLogToggle({
  captured,
  selectedCount,
  attach,
  disabled,
  onToggle,
  onPreview,
}: NetworkLogToggleProps) {
  const t = useT();

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Switch
                checked={attach}
                onCheckedChange={onToggle}
                disabled={disabled}
                id="network-log-toggle"
              />
              <label
                htmlFor="network-log-toggle"
                className={`text-sm ${disabled ? "text-muted-foreground" : "text-foreground"}`}
              >
                {t("networkLog.toggle.label")}
              </label>
            </div>
          </TooltipTrigger>
          {disabled && (
            <TooltipContent>
              <p>{t("networkLog.toggle.tooltip.empty")}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <span className="text-xs text-muted-foreground">
        {t("networkLog.counter.captured").replace("{n}", String(captured))}
        {attach && selectedCount > 0 && (
          <> · {t("networkLog.counter.selected").replace("{n}", String(selectedCount))}</>
        )}
      </span>
      {!disabled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onPreview}
        >
          <Eye className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
