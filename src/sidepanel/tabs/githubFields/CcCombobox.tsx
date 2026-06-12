import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
import type { GithubUser } from "@/types/github";
import { sendBg } from "@/types/messages";

interface Props {
  owner: string | undefined;
  repo: string | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}

export function CcCombobox({ owner, repo, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const ready = !!owner && !!repo;

  const load = useCallback(
    () =>
      sendBg<GithubUser[]>({
        type: "github.searchAssignees",
        owner: owner!,
        repo: repo!,
      }),
    [owner, repo],
  );
  const { items, loading, error } = useLazyListOnOpen(open, ready, load);

  function toggle(option: CcUserOption) {
    onChange(
      value.includes(option.key)
        ? value.filter((v) => v !== option.key)
        : [...value, option.key],
    );
  }

  return (
    <CcMultiCombobox
      options={items.map((u) => ({
        key: u.login,
        label: u.login,
        avatarUrl: u.avatarUrl,
      }))}
      selected={value.map((login) => ({ key: login, label: login }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      disabled={!ready}
      disabledLabel={t("github.field.requireRepo")}
      onOpenChange={setOpen}
    />
  );
}
