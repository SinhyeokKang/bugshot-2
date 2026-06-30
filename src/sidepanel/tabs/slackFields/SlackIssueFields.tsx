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
  // 직전 제출 채널을 우선(GitHub/Linear/Notion/GitLab와 동일). 기본 채널은 직전이 없을 때의 fallback.
  const channelId = last?.channelId ?? defaults?.channelId;
  const channelName = last?.channelName ?? defaults?.channelName;
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
