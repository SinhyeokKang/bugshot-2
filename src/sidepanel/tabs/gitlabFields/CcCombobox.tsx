import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
import type { GitlabMember } from "@/types/gitlab";
import { sendBg } from "@/types/messages";

export interface CcValue {
  username: string;
  name: string;
}

interface Props {
  projectId: number | undefined;
  value: CcValue[];
  onChange: (next: CcValue[]) => void;
}

export function CcCombobox({ projectId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const ready = projectId != null;

  const load = useCallback(
    () =>
      sendBg<GitlabMember[]>({
        type: "gitlab.searchAssignees",
        projectId: projectId!,
      }),
    [projectId],
  );
  const { items, loading, error } = useLazyListOnOpen(open, ready, load);

  function toggle(option: CcUserOption) {
    const next = value.some((v) => v.username === option.key)
      ? value.filter((v) => v.username !== option.key)
      : [...value, { username: option.key, name: option.label }];
    onChange(next);
  }

  return (
    <CcMultiCombobox
      options={items.map((u) => ({
        key: u.username,
        label: u.name,
        avatarUrl: u.avatarUrl,
      }))}
      selected={value.map((v) => ({ key: v.username, label: v.name }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      disabled={!ready}
      disabledLabel={t("gitlab.field.requireProject")}
      onOpenChange={setOpen}
    />
  );
}
