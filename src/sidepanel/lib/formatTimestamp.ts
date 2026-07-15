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
    // 리포터 브라우저 로컬 TZ의 GMT 오프셋 표기 — 글로벌 팀이 Captured 시각을 판독.
    timeZoneName: "shortOffset",
  });
}
