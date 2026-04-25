import { dateBcp47 } from "@/i18n";

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(dateBcp47(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
