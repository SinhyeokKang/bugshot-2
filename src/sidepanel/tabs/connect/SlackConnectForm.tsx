import { useEffect, useState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import { SlackIcon } from "@/components/icons/SlackIcon";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { useSettingsStore } from "@/store/settings-store";
import type { SlackAccount, SlackOAuthResult } from "@/types/slack";
import { isOAuthCancelled, sendBg } from "@/lib/bg-client";
import { ChannelCombobox, type ChannelValue } from "@/sidepanel/tabs/slackFields/ChannelCombobox";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { useAutoStart } from "./useAutoStart";
import { ReconnectConfirmDialog } from "./ReconnectConfirmDialog";

export function SlackConnectedBody() {
  return (
    <>
      <SlackSummary />
      <DefaultChannelField />
    </>
  );
}

export function SlackConnectFlow({
  connected,
  onConnected,
  autoStart,
  onAutoStartHandled,
}: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [reconnectConfirmOpen, setReconnectConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "slack.oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setConnecting(true);
    try {
      const result = await sendBg<SlackOAuthResult>({ type: "slack.startOAuth" });
      const next: SlackAccount = {
        platform: "slack",
        connectedAt: Date.now(),
        auth: result.auth,
        teamId: result.teamId,
        teamName: result.teamName,
        defaults: {},
      };
      setAccount("slack", next);
      onConnected();
    } catch (err) {
      if (!isOAuthCancelled(err)) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  // Slack만 수단 선택 다이얼로그가 없어(OAuth 전용) 클릭이 곧 OAuth였다 — 재연동이면
  // 초기화 확인을 먼저 세운다(형제 셸은 그 문구를 수단 선택 다이얼로그가 들고 있다).
  function handleClick() {
    if (connecting) return;
    if (!oauthAvailable) return;
    if (connected) {
      setReconnectConfirmOpen(true);
      return;
    }
    void startOAuth();
  }

  // intent를 **소비**해야 한다 — 안 부르면 reconnectPlatform이 고착돼 연동 탭 서브탭이
  // "add"에 붙는다. 지금 이 경로는 도달 불가다(slack-api에 refresh 레인이 없어 refreshFailed
  // 태깅이 0건이고 만료 안내가 slack을 지목하지 못한다). 그래도 배선해 두는 건 slack에
  // 토큰 회전이 붙는 순간 그 고착이 바로 실화되기 때문이다.
  useAutoStart({
    autoStart,
    // 가용성이 **거짓으로 확정**된 경우도 ready로 본다 — 형제 셸은 connectMethods가
    // ["token"]으로 수렴해 이 상태가 없지만 Slack은 OAuth 전용이라 영구 false가 가능하고,
    // 그러면 intent가 영영 소비되지 않아 연동 탭 서브탭이 "add"에 고착된다.
    ready: oauthAvailable !== null && !connecting,
    onHandled: onAutoStartHandled,
    start: handleClick,
  });

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={!oauthAvailable}
        aria-disabled={connecting}
        className="relative w-full justify-center gap-2 aria-disabled:cursor-not-allowed"
      >
        {connected && (
          <CircleCheck className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-green-700 dark:text-green-400" />
        )}
        {connecting && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={`inline-flex min-w-0 max-w-full items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
          <SlackIcon className="h-4 w-4" />
          <span className="truncate">
            {connected
              ? t("platform.reconnect", { platform: t("platform.tab.slack") })
              : t("platform.connectPlatform", { platform: t("platform.tab.slack") })}
          </span>
        </span>
      </Button>
      <ReconnectConfirmDialog
        open={reconnectConfirmOpen}
        onOpenChange={setReconnectConfirmOpen}
        platformLabel={t("platform.tab.slack")}
        onConfirm={() => void startOAuth()}
      />
    </>
  );
}

function DefaultChannelField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.slack);
  const updateSlackAccount = useSettingsStore((s) => s.updateSlackAccount);
  if (!account) return null;
  const value: ChannelValue | null =
    account.defaults.channelId && account.defaults.channelName
      ? {
          channelId: account.defaults.channelId,
          channelName: account.defaults.channelName,
        }
      : null;
  return (
    <FieldRow label={t("slack.section.channel")}>
      <ChannelCombobox
        value={value}
        onChange={(next) =>
          updateSlackAccount({
            defaults: next
              ? { channelId: next.channelId, channelName: next.channelName }
              : { channelId: undefined, channelName: undefined },
          })
        }
      />
    </FieldRow>
  );
}

function SlackSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.slack);
  if (!account) return null;
  const name = account.auth.viewerName || t("slack.viewerName");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{name}</span>
            <span className="truncate text-sm text-muted-foreground">
              {account.teamName || t("platform.tab.slack")}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
