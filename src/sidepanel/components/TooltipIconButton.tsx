import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// 툴바 아이콘 버튼 공용 — 캡처 방식 툴바와 어노테이션 툴바(이미지·녹화)가 함께 쓴다.
// Provider를 안에 두는 이유: 툴바가 여러 화면(오버레이·footer)에 흩어져 있어 상위에
// Provider가 있다는 보장이 없다. Radix Provider는 중첩해도 안전하다.
export function TooltipIconButton({
  label,
  active,
  disabled,
  ariaDisabled,
  disabledReason,
  testId,
  className,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  ariaDisabled?: boolean;
  /**
   * 잠금 사유. 있으면 **툴팁 본문만** 대체하고 aria-label은 label을 그대로 둔다 —
   * label 하나가 둘을 겸하고 있어서 사유를 label에 섞으면 접근명이
   * "페이지 캡처(디바이스 모드에서 잠김)"가 된다.
   */
  disabledReason?: string;
  testId?: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className={cn("h-8 w-8 shrink-0", active && "bg-muted", className)}
            data-active={active || undefined}
            data-testid={testId}
            aria-label={label}
            aria-pressed={active}
            aria-disabled={ariaDisabled}
            disabled={disabled}
            onClick={() => {
              if (ariaDisabled) return;
              onClick?.();
            }}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{disabledReason ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
