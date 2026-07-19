import { dateBcp47 } from "@/i18n";

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const dateStr = d.toLocaleString(dateBcp47(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // 24시간제(00–23) — AM/PM 제거. h23이라 자정이 24:xx가 아니라 00:xx.
    // hourCycle은 시 표기만 바꿔 콜론 스켈레톤은 유지된다(timeZoneName과 달리 ko 스켈레톤 미전환).
    hourCycle: "h23",
  });
  return `${dateStr} ${gmtOffset(d)}`;
}

// 리포터 로컬 TZ의 GMT 오프셋("GMT+9"/"GMT+5:30"/"GMT") — 글로벌 팀이 Captured 시각을 판독.
// toLocaleString의 timeZoneName 옵션을 쓰면 ko에서 시간 스켈레톤이 콜론→시/분/초로 바뀌므로
// (분 패딩까지 깨짐) 옵션이 아니라 suffix로 붙인다.
function gmtOffset(d: Date): string {
  const min = -d.getTimezoneOffset(); // getTimezoneOffset: UTC 뒤처짐 분(+가 서쪽). KST -540 → +540
  if (min === 0) return "GMT";
  const sign = min > 0 ? "+" : "-";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}
