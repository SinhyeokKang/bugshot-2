import { cn } from "@/lib/utils";

export const docTableCell = "px-3 py-2.5 align-top";
export const docTableHead = "px-3 py-2.5 font-semibold text-left";
export const docTableRow = "border-b border-border/60 last:border-b-0";

export function DocTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/60",
        className,
      )}
    >
      <table className="w-full table-fixed border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}
