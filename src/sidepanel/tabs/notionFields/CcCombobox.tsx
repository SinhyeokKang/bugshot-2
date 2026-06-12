import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import {
  MultiUserCombobox,
  type MultiUserOption,
} from "@/sidepanel/components/MultiUserCombobox";
import type { NotionUser } from "@/types/notion";
import { BgError, sendBg } from "@/types/messages";

export interface CcValue {
  id: string;
  name: string;
}

interface Props {
  value: CcValue[];
  onChange: (next: CcValue[]) => void;
}

export function CcCombobox({ value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotionUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<NotionUser[]>({ type: "notion.listUsers" })
      .then((list) => {
        if (myReq !== reqIdRef.current) return;
        setItems(list);
      })
      .catch((err: unknown) => {
        if (myReq !== reqIdRef.current) return;
        // 403 = 통합에 "사용자 정보 읽기" capability 부재 — 재연결 안내로 치환.
        if (err instanceof BgError && err.status === 403) {
          setError(t("field.cc.notionCapabilityError"));
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (myReq !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [open, items.length, t]);

  function toggle(option: MultiUserOption) {
    onChange(
      value.some((v) => v.id === option.key)
        ? value.filter((v) => v.id !== option.key)
        : [...value, { id: option.key, name: option.label }],
    );
  }

  return (
    <MultiUserCombobox
      options={items.map((u) => ({
        key: u.id,
        label: u.name,
        avatarUrl: u.avatarUrl,
      }))}
      selected={value.map((v) => ({ key: v.id, label: v.name }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      placeholder={t("field.cc.select")}
      searchPlaceholder={t("field.cc.search")}
      emptyMessage={t("field.cc.empty")}
      onOpenChange={setOpen}
    />
  );
}
