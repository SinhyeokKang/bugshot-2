import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import {
  MultiUserCombobox,
  type MultiUserOption,
} from "@/sidepanel/components/MultiUserCombobox";
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
  const [items, setItems] = useState<LinearUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedTeamId, setLoadedTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !teamId) return;
    if (loadedTeamId === teamId && items.length > 0) return;
    setLoading(true);
    setError(null);
    sendBg<LinearUser[]>({ type: "linear.getMembers", teamId })
      .then((list) => {
        setItems(list);
        setLoadedTeamId(teamId);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [open, teamId]);

  function toggle(option: MultiUserOption) {
    onChange(
      value.some((v) => v.id === option.key)
        ? value.filter((v) => v.id !== option.key)
        : [...value, { id: option.key, name: option.label }],
    );
  }

  return (
    <MultiUserCombobox
      options={items.map((u) => ({ key: u.id, label: u.name }))}
      selected={value.map((v) => ({ key: v.id, label: v.name }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      disabled={!teamId}
      disabledLabel={t("linear.field.requireTeam")}
      placeholder={t("field.cc.select")}
      searchPlaceholder={t("field.cc.search")}
      emptyMessage={t("field.cc.empty")}
      onOpenChange={setOpen}
    />
  );
}
