import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import {
  MultiUserCombobox,
  type MultiUserOption,
} from "@/sidepanel/components/MultiUserCombobox";
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
  const [items, setItems] = useState<GithubUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!owner && !!repo;

  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<GithubUser[]>({
      type: "github.searchAssignees",
      owner: owner!,
      repo: repo!,
    })
      .then((list) => {
        if (myReq !== reqIdRef.current) return;
        setItems(list);
      })
      .catch((err: unknown) => {
        if (myReq !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (myReq !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [open, ready, owner, repo, items.length]);

  useEffect(() => {
    setItems([]);
  }, [owner, repo]);

  function toggle(option: MultiUserOption) {
    onChange(
      value.includes(option.key)
        ? value.filter((v) => v !== option.key)
        : [...value, option.key],
    );
  }

  return (
    <MultiUserCombobox
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
      placeholder={t("field.cc.select")}
      searchPlaceholder={t("field.cc.search")}
      emptyMessage={t("field.cc.empty")}
      onOpenChange={setOpen}
    />
  );
}
