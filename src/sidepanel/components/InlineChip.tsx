import type { ReactNode } from "react";

export function InlineChip({
  children,
  muted,
  title,
  className,
  "aria-label": ariaLabel,
  "data-testid": dataTestid,
}: {
  children: ReactNode;
  muted?: boolean;
  title?: string;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const tone = muted
    ? "border-dashed text-muted-foreground"
    : "border-primary";
  return (
    <span
      aria-label={ariaLabel}
      data-testid={dataTestid}
      title={title}
      className={`mx-0.5 rounded-sm border ${tone} bg-background px-1 py-0.5 [box-decoration-break:clone] break-words${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}
