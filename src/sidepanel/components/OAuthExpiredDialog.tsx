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
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";

/**
 * 토큰 갱신이 실패했을 때의 재로그인 안내. 액션이 연동 탭 이동이 아니라 **재연동 자체**인
 * 게 핵심이다 — 탭까지만 데려다주면 그 화면에서도 연결된 플랫폼 행에는 해제 버튼만 있어,
 * 사용자가 해제부터 하고 다시 연결해야 했다.
 */
export function OAuthExpiredDialog({
  platform,
  onOpenChange,
  onReconnect,
}: {
  platform: PlatformId | null;
  onOpenChange: (open: boolean) => void;
  onReconnect: (platform: PlatformId) => void;
}) {
  const t = useT();
  // 닫혀 있을 때만 null이라 표시에 쓰이지 않는다. 폴백 플랫폼을 세우지 않는 건 이 값이
  // 라벨이자 **재연동 대상**이라, 틀리면 엉뚱한 플랫폼의 OAuth 창이 뜨기 때문이다.
  const label = platform ? t(PLATFORM_TAB_KEYS[platform]) : "";

  return (
    <AlertDialog open={platform != null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("platform.oauthExpired.title", { platform: label })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("platform.oauthExpired.body", { platform: label })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => platform && onReconnect(platform)}
          >
            {t("platform.oauthExpired.reconnect")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
