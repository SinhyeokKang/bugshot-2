import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import { ChannelIcon } from "@/sidepanel/tabs/slackFields/ChannelIcon";
import type { SlackChannel } from "@/types/slack";
import { sendBg } from "@/types/messages";

export interface ChannelValue {
  channelId: string;
  channelName: string;
}

interface Props {
  value: ChannelValue | null;
  onChange: (next: ChannelValue | null) => void;
  disabled?: boolean;
}

export function ChannelCombobox({ value, onChange, disabled }: Props) {
  const t = useT();
  const load = useCallback(
    () => sendBg<SlackChannel[]>({ type: "slack.listChannels" }),
    [],
  );

  return (
    <SingleLazyCombobox
      disabled={!!disabled}
      load={load}
      getKey={(c) => c.id}
      getName={(c) => c.name}
      renderItem={(c) => (
        <span className="flex min-w-0 items-center gap-2">
          <ChannelIcon channel={c} />
          <span className="truncate">{c.name.replace(/^#/, "")}</span>
        </span>
      )}
      selectedKey={value?.channelId ?? null}
      onSelect={(c) =>
        onChange(c ? { channelId: c.id, channelName: c.name } : null)
      }
      triggerLabel={value ? value.channelName : t("slack.field.channel.select")}
      searchPlaceholder={t("slack.field.channel.search")}
      emptyLabel={t("slack.field.channel.empty")}
    />
  );
}
