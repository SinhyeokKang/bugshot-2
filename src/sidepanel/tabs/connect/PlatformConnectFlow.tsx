import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings-store";
import type { TranslationKey } from "@/i18n/ko";
import type { BgRequest } from "@/types/messages";
import { PLATFORM_TAB_KEYS, type Accounts, type PlatformId } from "@/types/platform";
import { isOAuthCancelled, sendBg } from "@/lib/bg-client";
import { connectMethods, type ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectMethodDialog } from "./ConnectMethodDialog";

interface PlatformConnectFlowProps<P extends PlatformId, A> extends ConnectFlowProps {
  platform: P;
  icon: ReactNode;
  tokenLabelKey: TranslationKey;
  // 조립된 BgRequest를 받는다 — `${platform}.startOAuth`로 문자열을 만들면 union 검사가 죽는다.
  // 타입을 platform에 묶는다. 그냥 BgRequest면 존재하지 않는 타입만 걸리고, 다른 플랫폼의
  // 유효한 타입(github 슬롯에 notion.startOAuth)은 통과해 남의 토큰이 이 계정에 저장된다.
  // NoInfer가 핵심 — 없으면 P가 이 자리에서도 추론 후보를 얻어 넓어지고, 그러면
  // 어긋난 조합이 그대로 통과한다(실측: Extract·교차 타입 둘 다 무력했다).
  // 아래 effect가 요청을 platform의 순수 함수로 전제하는 근거이기도 하다.
  availableRequest: BgRequest & { type: `${NoInfer<P>}.oauth.available` };
  startOAuthRequest: BgRequest & { type: `${NoInfer<P>}.startOAuth` };
  // 계정 리터럴은 호출부에 남긴다. 여기서 조립하면 excess property check가 사라져
  // optional 필드 오타가 typecheck를 통과한다(POSTMORTEM 2026-08-14).
  buildAccount: (auth: A) => Accounts[P];
  renderTokenDialog: (props: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) => ReactNode;
}

export function PlatformConnectFlow<P extends PlatformId, A>({
  connected,
  onConnected,
  platform,
  icon,
  tokenLabelKey,
  availableRequest,
  startOAuthRequest,
  buildAccount,
  renderTokenDialog,
}: PlatformConnectFlowProps<P, A>) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);

  // 의존성은 platform이지 availableRequest가 아니다 — 후자는 호출부의 인라인 리터럴이라
  // 렌더마다 새 참조이고, 의존성에 두면 조상이 리렌더할 때마다 oauth.available을 다시
  // 조회한다(IntegrationsTab은 CSS hidden으로만 감춰져 언마운트되지 않는다). 요청은
  // platform의 순수 함수이고 그건 위 prop 타입이 강제한다.
  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>(availableRequest)
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  async function startOAuth() {
    setConnecting(true);
    try {
      const auth = await sendBg<A>(startOAuthRequest);
      setAccount(platform, buildAccount(auth));
      onConnected();
    } catch (err) {
      if (!isOAuthCancelled(err)) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  const methods = connectMethods(oauthAvailable);
  const platformLabel = t(PLATFORM_TAB_KEYS[platform]);

  function handleClick() {
    if (methods.length === 0) return;
    if (connecting) return;
    if (methods.includes("oauth")) {
      setMethodOpen(true);
    } else {
      setTokenOpen(true);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={connected || methods.length === 0}
        aria-disabled={connecting}
        className="relative w-full justify-center gap-2 aria-disabled:cursor-not-allowed"
      >
        {connecting && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={`inline-flex min-w-0 max-w-full items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
          {icon}
          <span className="truncate">
            {connected
              ? t("platform.connected", { platform: platformLabel })
              : t("platform.connectPlatform", { platform: platformLabel })}
          </span>
        </span>
      </Button>

      <ConnectMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        platformLabel={platformLabel}
        oauthLabel={t("platform.connectMethod.oauth")}
        tokenLabel={t(tokenLabelKey)}
        onChooseOAuth={() => void startOAuth()}
        onChooseToken={() => setTokenOpen(true)}
      />
      {renderTokenDialog({ open: tokenOpen, onOpenChange: setTokenOpen })}
    </>
  );
}
