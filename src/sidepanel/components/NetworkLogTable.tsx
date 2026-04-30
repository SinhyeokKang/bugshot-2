import { cn } from "@/lib/utils";
import type { NetworkRequest } from "@/types/network";
import { networkLogPath } from "../lib/buildIssueMarkdown";
import {
  DocTable,
  docTableCell,
  docTableHead,
  docTableRow,
} from "./DocTable";

export function NetworkLogTable({
  requests,
  selectedIds,
}: {
  requests: NetworkRequest[];
  selectedIds: string[];
}) {
  const selected = new Set(selectedIds);
  const rows = requests.filter((r) => selected.has(r.id));
  if (rows.length === 0) return null;

  return (
    <DocTable>
      <colgroup>
        <col className="w-[18%]" />
        <col />
        <col className="w-[22%]" />
        <col className="w-[16%]" />
      </colgroup>
      <thead>
        <tr className={cn("bg-muted/40", docTableRow)}>
          <th className={docTableHead}>Method</th>
          <th className={docTableHead}>Path</th>
          <th className={docTableHead}>Status</th>
          <th className={docTableHead}>Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={docTableRow}>
            <td className={cn(docTableCell, "font-medium")}>{r.method}</td>
            <td className={cn(docTableCell, "truncate")}>{networkLogPath(r.url)}</td>
            <td className={docTableCell}>
              {r.status} {r.statusText}
            </td>
            <td className={docTableCell}>{r.durationMs}ms</td>
          </tr>
        ))}
      </tbody>
    </DocTable>
  );
}
