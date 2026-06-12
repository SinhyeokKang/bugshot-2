import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import {
  MultiUserCombobox,
  type MultiUserOption,
} from "@/sidepanel/components/MultiUserCombobox";
import type { AsanaUser } from "@/types/asana";
import { sendBg } from "@/types/messages";

export interface CcValue {
  gid: string;
  name: string;
}

interface Props {
  workspaceGid: string | undefined;
  value: CcValue[];
  onChange: (next: CcValue[]) => void;
}

export function CcCombobox({ workspaceGid, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AsanaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const ready = !!workspaceGid;

  // searchUsers는 서버 검색이 없어 워크스페이스 멤버를 1회 받아 클라이언트 필터 (AssigneeCombobox 패턴).
  useEffect(() => {
    if (!open || !ready) return;
    if (items.length > 0) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    sendBg<AsanaUser[]>({
      type: "asana.searchAssignees",
      workspaceGid: workspaceGid!,
      query: "",
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
  }, [open, ready, workspaceGid, items.length]);

  useEffect(() => {
    setItems([]);
  }, [workspaceGid]);

  function toggle(option: MultiUserOption) {
    onChange(
      value.some((v) => v.gid === option.key)
        ? value.filter((v) => v.gid !== option.key)
        : [...value, { gid: option.key, name: option.label }],
    );
  }

  return (
    <MultiUserCombobox
      options={items.map((u) => ({ key: u.gid, label: u.name }))}
      selected={value.map((v) => ({ key: v.gid, label: v.name }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      disabled={!ready}
      disabledLabel={t("asana.field.requireWorkspace")}
      placeholder={t("field.cc.select")}
      searchPlaceholder={t("field.cc.search")}
      emptyMessage={t("field.cc.empty")}
      onOpenChange={setOpen}
    />
  );
}
