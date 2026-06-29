import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
import type { ClickupUser } from "@/types/clickup";
import { sendBg } from "@/types/messages";

export interface CcValue {
  id: string;
  name: string;
}

interface Props {
  workspaceId: string | undefined;
  value: CcValue[];
  onChange: (next: CcValue[]) => void;
}

export function CcCombobox({ workspaceId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const ready = !!workspaceId;

  const load = useCallback(
    () =>
      sendBg<ClickupUser[]>({
        type: "clickup.getMembers",
        teamId: workspaceId!,
      }),
    [workspaceId],
  );
  const { items, loading, error } = useLazyListOnOpen(open, ready, load);

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
      disabled={!ready}
      disabledLabel={t("clickup.field.requireWorkspace")}
      onOpenChange={setOpen}
    />
  );
}
