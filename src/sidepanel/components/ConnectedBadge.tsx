import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ConnectedBadge({ children }: { children: ReactNode }) {
  return (
    <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
      <CircleCheck className="h-3 w-3" />
      {children}
    </Badge>
  );
}
