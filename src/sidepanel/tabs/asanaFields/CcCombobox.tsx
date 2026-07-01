import { useCallback, useState } from "react";
import { useT } from "@/i18n";
import {
  CcMultiCombobox,
  type CcUserOption,
} from "@/sidepanel/components/CcMultiCombobox";
import { useLazyListOnOpen } from "@/sidepanel/hooks/useLazyListOnOpen";
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

  const ready = !!workspaceGid;

  // searchUsers는 서버 검색이 없어 워크스페이스 멤버를 1회 받아 클라이언트 필터 (AssigneeCombobox 패턴).
  const load = useCallback(
    () =>
      sendBg<AsanaUser[]>({
        type: "asana.searchAssignees",
        workspaceGid: workspaceGid!,
        query: "",
      }),
    [workspaceGid],
  );
  const { items, loading, error } = useLazyListOnOpen(open, ready, load);

  function toggle(option: CcUserOption) {
    onChange(
      value.some((v) => v.gid === option.key)
        ? value.filter((v) => v.gid !== option.key)
        : [...value, { gid: option.key, name: option.label }],
    );
  }

  return (
    <CcMultiCombobox
      options={items.map((u) => ({ key: u.gid, label: u.name, email: u.email }))}
      selected={value.map((v) => ({ key: v.gid, label: v.name }))}
      onToggle={toggle}
      onClear={() => onChange([])}
      loading={loading}
      error={error}
      disabled={!ready}
      disabledLabel={t("asana.field.requireWorkspace")}
      onOpenChange={setOpen}
    />
  );
}
