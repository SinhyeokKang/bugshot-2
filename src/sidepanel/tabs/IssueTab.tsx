import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";

export function IssueTab() {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border p-4">
        <h2 className="text-base font-semibold">요소 선택</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          페이지에서 수정하고 싶은 요소를 집어 스타일을 바꾸고 Jira 이슈로
          전송하세요.
        </p>
        <Button className="mt-3 w-full" disabled>
          <Crosshair />
          요소 선택 시작
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          (#24 Picker + #25 편집 UI에서 구현)
        </p>
      </div>
    </div>
  );
}
