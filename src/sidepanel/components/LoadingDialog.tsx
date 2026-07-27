import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// 사용자가 끊을 수 없는 장기 작업의 진행 화면. 액션 차단이 곧 계약이라 AlertDialog를 쓰고
// (바깥 클릭이 안 통한다) ESC까지 막는다 — 작업이 끝나 open이 false가 될 때만 닫힌다.
// 본문 골격은 EmptyShell·녹화 중 화면(IssueTab)과 같다: 원형 아이콘 → 제목 → 설명 → 진행률.
export function LoadingDialog({
  open,
  icon,
  title,
  description,
  percent,
  progressLabel,
  className,
}: {
  open: boolean;
  icon: ReactNode;
  title: string;
  // 필수 — 끊을 수 없는 대기라 "왜 기다려야 하는지"가 없으면 안내가 성립하지 않는다.
  // AlertDialogContent가 Description 부재를 접근성 경고로 잡기도 한다.
  description: string;
  // 0~100. 없으면 진행률 바를 그리지 않는다 — 진척을 못 재는 작업은 아이콘 슬롯에 스피너를 넣는다.
  percent?: number;
  progressLabel?: string;
  className?: string;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className={cn("items-center text-center", className)}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="loading-dialog"
      >
        <div className="rounded-full bg-muted p-3">{icon}</div>
        {/* 제목과 안내는 한 덩어리로 읽혀야 한다 — 컨테이너 gap-4를 물려받으면 둘이 갈라진다. */}
        <div className="flex flex-col gap-1">
          <AlertDialogTitle className="text-lg font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            {description}
          </AlertDialogDescription>
        </div>
        {percent !== undefined ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={progressLabel}
            >
              <div
                className="h-full rounded-full bg-foreground transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span
              className="text-sm tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {percent}%
            </span>
          </div>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
