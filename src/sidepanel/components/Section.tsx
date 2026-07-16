import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export function PageShell({
  children,
  className,
  "data-testid": testid,
}: {
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid={testid}>
      {children}
    </div>
  );
}

export function PageScroll({
  children,
  contentClassName,
}: {
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* contentClassName은 내부 컬럼에 붙는다 — flex-1 자식으로 뷰포트를 채우려면 min-h-full 주입용. */}
      <div className={cn("flex flex-col", contentClassName)}>{children}</div>
    </div>
  );
}

export function PageFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 flex flex-col gap-2 border-t border-border bg-muted/50 p-4">
      {children}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  collapsible,
  defaultOpen = true,
  testId,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <section
      className="border-b border-border py-6 last:border-b-0"
      data-testid={testId}
    >
      <div className="flex flex-col gap-3 px-4">
        {title || action ? (
          <div className="flex items-center justify-between gap-2">
            {title ? (
              <h3 className="text-base font-semibold">{title}</h3>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              {action}
              {collapsible && (
                <SectionToggle
                  open={open}
                  onToggle={() => setOpen((v) => !v)}
                  testId={testId ? `${testId}-toggle` : undefined}
                />
              )}
            </div>
          </div>
        ) : null}
        {(!collapsible || open) && (
          <div className="flex flex-col gap-3">{children}</div>
        )}
      </div>
    </section>
  );
}

function SectionToggle({
  open,
  onToggle,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  const t = useT();
  const label = open ? t("common.collapse") : t("common.expand");
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onToggle}
      data-testid={testId}
      aria-label={label}
      title={label}
      className="h-8 w-8 shrink-0"
    >
      <ChevronDown
        className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
      />
    </Button>
  );
}
