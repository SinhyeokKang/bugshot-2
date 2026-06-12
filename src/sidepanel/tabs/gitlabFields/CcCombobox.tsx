import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import {
  MultiUserCombobox,
  type MultiUserOption,
} from "@/sidepanel/components/MultiUserCombobox";
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
  const [items, setItems] = useState<GitlabMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = projectId != null;

  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<GitlabMember[]>({
      type: "gitlab.searchAssignees",
      projectId: projectId!,
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
  }, [open, ready, projectId, items.length]);

  useEffect(() => {
    setItems([]);
  }, [projectId]);

  function toggle(option: MultiUserOption) {
    const next = value.some((v) => v.username === option.key)
      ? value.filter((v) => v.username !== option.key)
      : [...value, { username: option.key, name: option.label }];
    onChange(next);
  }

  return (
    <MultiUserCombobox
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
      placeholder={t("field.cc.select")}
      searchPlaceholder={t("field.cc.search")}
      emptyMessage={t("field.cc.empty")}
      onOpenChange={setOpen}
    />
  );
}
