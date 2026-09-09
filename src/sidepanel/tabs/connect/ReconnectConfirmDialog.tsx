import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/i18n";

/**
 * 재연동 전 초기화 확인. **연결 수단 선택 다이얼로그를 지나지 않는 재연동 경로만** 이걸 세운다
 * (그 다이얼로그는 같은 문구를 인터스티셜로 이미 보여준다).
 *
 * 재연동은 계정을 교체하므로(`setAccount` 전체 대입 + 그 플랫폼의 직전 제출값 삭제) 기본값과
 * 제출 목적지가 함께 초기화된다. 종전에 그 손실에 도달하는 유일한 경로는 해제 버튼의 확인
 * 다이얼로그였는데, 재연동을 상시 경로로 열면서 확인 없이 도달하는 분기가 생겼다 —
 * OAuth가 미구성인 환경(client id 누락·self-managed)의 토큰 직행, 그리고 수단 선택이 아예
 * 없는 Slack이 그것이다. 하필 그 환경이 self-hosted 엔터프라이즈다.
 */
export function ReconnectConfirmDialog({
  open,
  onOpenChange,
  platformLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  platformLabel: string;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("platform.reconnect.title", { platform: platformLabel })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("platform.reconnect.note")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("platform.reconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
