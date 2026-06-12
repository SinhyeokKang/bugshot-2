import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
import type { LinearUser } from "@/types/linear";
import { sendBg } from "@/types/messages";

export interface CcValue {
  id: string;
  name: string;
}

interface Props {
  teamId: string | undefined;
  value: CcValue[];
  onChange: (next: CcValue[]) => void;
}

export function CcCombobox({ teamId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const load = useCallback(
    () => sendBg<LinearUser[]>({ type: "linear.getMembers", teamId: teamId! }),
    [teamId],
  );
  const { items, loading, error } = useLazyListOnOpen(open, !!teamId, load);

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
      disabled={!teamId}
      disabledLabel={t("linear.field.requireTeam")}
      onOpenChange={setOpen}
    />
  );
}
