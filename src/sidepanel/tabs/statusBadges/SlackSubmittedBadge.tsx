import { useEffect } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";

// Slack 메시지엔 open/closed 같은 상태가 없어 상태 폴링 없이 정적 "전송됨" 배지만 낸다.
// permalink 이동은 IssueRow의 카드 클릭(issue.url)이 담당한다.
export function SlackSubmittedBadge({ onLoaded }: { onLoaded: () => void }) {
  const t = useT();
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return (
    <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
      {t("issueList.submitted")}
    </Badge>
  );
}
