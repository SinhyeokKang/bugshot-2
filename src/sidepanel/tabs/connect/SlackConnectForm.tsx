import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SlackIcon } from "@/components/icons/SlackIcon";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSettingsStore } from "@/store/settings-store";
import type { SlackAccount, SlackOAuthResult } from "@/types/slack";
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { ChannelCombobox, type ChannelValue } from "@/sidepanel/tabs/slackFields/ChannelCombobox";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";

export function SlackConnectedBody() {
  return (
    <>
      <SlackSummary />
      <DefaultChannelField />
    </>
  );
}

export function SlackConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  return (
    <Button
      variant="outline"
      onClick={() => { if (connecting) return; void startOAuth(); }}
      disabled={connected || !oauthAvailable}
      aria-disabled={connecting}
      className="relative w-full justify-center gap-2 aria-disabled:cursor-not-allowed"
    >
      {connecting && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      )}
      <span className={`inline-flex items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
        <SlackIcon className="h-4 w-4" />
        {connected
          ? t("platform.connected", { platform: t("platform.tab.slack") })
          : t("platform.connectPlatform", { platform: t("platform.tab.slack") })}
      </span>
    </Button>
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
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t("slack.section.channel")}</label>
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
    </div>
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
