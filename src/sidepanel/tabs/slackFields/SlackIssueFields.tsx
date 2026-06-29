import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import type { SlackDefaults } from "@/types/slack";
import type { SlackLastSubmitFields } from "@/types/platform";
import { ChannelCombobox, type ChannelValue } from "./ChannelCombobox";
import { MentionCombobox } from "./MentionCombobox";

export interface SlackIssueFieldsValue {
  channelId?: string;
  channelName?: string;
  mentions?: { id: string; name: string }[];
}

export function initialSlackFields(
  last: SlackLastSubmitFields | undefined,
  defaults: SlackDefaults | undefined,
): SlackIssueFieldsValue {
  const channelId = defaults?.channelId ?? last?.channelId;
  const channelName = defaults?.channelName ?? last?.channelName;
  const sameChannel = !!last?.channelId && last.channelId === channelId;
  return {
    channelId,
    channelName,
    mentions: sameChannel ? last?.mentions : undefined,
  };
}

interface Props {
  value: SlackIssueFieldsValue;
  onChange: (patch: Partial<SlackIssueFieldsValue>) => void;
}

export function SlackIssueFields({ value, onChange }: Props) {
  const t = useT();

  const channelValue: ChannelValue | null =
    value.channelId && value.channelName
      ? { channelId: value.channelId, channelName: value.channelName }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("slack.field.channel")} required>
        <ChannelCombobox
          value={channelValue}
          onChange={(next) =>
            onChange({ channelId: next?.channelId, channelName: next?.channelName })
          }
        />
      </FieldRow>

      <FieldRow label={t("slack.field.mention")}>
        <MentionCombobox
          value={value.mentions ?? []}
          onChange={(mentions) => onChange({ mentions })}
        />
      </FieldRow>
    </div>
  );
}
