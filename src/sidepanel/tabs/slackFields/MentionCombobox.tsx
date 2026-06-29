import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
import type { SlackUser } from "@/types/slack";
import { sendBg } from "@/types/messages";

export interface MentionValue {
  id: string;
  name: string;
}

interface Props {
  value: MentionValue[];
  onChange: (next: MentionValue[]) => void;
}

export function MentionCombobox({ value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () => sendBg<SlackUser[]>({ type: "slack.listMembers" }),
    [],
  );
  const { items, loading, error } = useLazyListOnOpen(open, true, load);

  function toggle(option: CcUserOption) {
    onChange(
      value.some((v) => v.id === option.key)
        ? value.filter((v) => v.id !== option.key)
        : [...value, { id: option.key, name: option.label }],
    );
  }

  return (
    <CcMultiCombobox
      options={items.map((u) => ({ key: u.id, label: u.name }))}
      selected={value.map((v) => ({ key: v.id, label: v.name }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      onOpenChange={setOpen}
      selectLabel={t("slack.field.mention.select")}
      searchPlaceholder={t("slack.field.mention.search")}
      emptyLabel={t("slack.field.mention.empty")}
    />
  );
}
