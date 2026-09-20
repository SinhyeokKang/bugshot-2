import { useEffect } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";

// 수신 서버가 상태 조회 API를 가진다는 보장이 없다 — 되물을 곳이 없으므로 폴링 없이 정적
// "전송됨" 배지만 낸다. onLoaded를 부르지 않으면 그 행만 로딩 스피너에 영구히 갇힌다.
export function WebhookSubmittedBadge({ onLoaded }: { onLoaded: () => void }) {
  const t = useT();
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return (
    <Badge variant="outline" className="w-fit shrink-0 text-[11px]" data-testid="webhook-submitted-badge">
      {t("issueList.submitted")}
    </Badge>
  );
}
