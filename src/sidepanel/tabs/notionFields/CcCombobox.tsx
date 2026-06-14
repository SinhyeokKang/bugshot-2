import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
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

  const load = useCallback(
    () => sendBg<NotionUser[]>({ type: "notion.listUsers" }),
    [],
  );
  // 403 = 통합에 "사용자 정보 읽기" capability 부재 — 재연결 안내로 치환. (훅이 latest-ref로 받아 비메모이즈 OK)
  const formatError = (err: unknown) => {
    if (err instanceof BgError && err.status === 403) {
      return t("field.cc.notionCapabilityError");
    }
    return err instanceof Error ? err.message : String(err);
  };
  const { items, loading, error } = useLazyListOnOpen(
    open,
    true,
    load,
    formatError,
  );

  function toggle(option: CcUserOption) {
    onChange(
      value.some((v) => v.id === option.key)
        ? value.filter((v) => v.id !== option.key)
        : [...value, { id: option.key, name: option.label }],
    );
  }

  return (
    <CcMultiCombobox
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
      onOpenChange={setOpen}
    />
  );
}
